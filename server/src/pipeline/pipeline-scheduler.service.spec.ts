import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { PipelineSchedulerService } from './pipeline-scheduler.service';
import { PipelineRunnerService } from './pipeline-runner.service';
import { PipelineStateService } from './pipeline-state.service';
import { PipelineHistoryService } from './pipeline-history.service';
import { PipelineLockService } from './pipeline-lock.service';
import { pythonUtcIso } from '../common/utils/iso-time';

function makeScheduler(
  overrides: Record<string, unknown> = {},
  stateDoc: Record<string, unknown> = {},
) {
  const values: Record<string, unknown> = {
    'pipeline.onApi': false,
    'pipeline.catchupOnStart': true,
    'pipeline.intervalHours': 1,
    'pipeline.python.cwd': 'C:/fake/server',
    'database.uri': 'mongodb://localhost:27017',
    ...overrides,
  };
  const config = { get: (k: string) => values[k] } as unknown as ConfigService;
  const registry = new SchedulerRegistry();
  const runner = { run: jest.fn().mockResolvedValue({ status: 'success' }) };
  const state = {
    getState: jest.fn().mockResolvedValue(stateDoc),
    updateState: jest.fn().mockResolvedValue({}),
    pingDiagnostics: jest.fn().mockResolvedValue({ ok: true }),
  };
  const history = { ensureIndexes: jest.fn().mockResolvedValue(undefined) };
  const lock = {
    ensureIndexes: jest.fn().mockResolvedValue(undefined),
    releaseLocalOrphan: jest.fn().mockResolvedValue(false),
  };

  const scheduler = new PipelineSchedulerService(
    config,
    registry,
    runner as unknown as PipelineRunnerService,
    state as unknown as PipelineStateService,
    history as unknown as PipelineHistoryService,
    lock as unknown as PipelineLockService,
  );
  return { scheduler, runner, state, registry };
}

describe('PipelineSchedulerService', () => {
  it('stays off when PIPELINE_ON_API is false (Flask remains the writer)', async () => {
    const { scheduler, runner, state } = makeScheduler();
    await scheduler.onModuleInit();
    expect(scheduler.isRunning()).toBe(false);
    expect(scheduler.nextRunIso()).toBeNull();
    expect(runner.run).not.toHaveBeenCalled();
    expect(state.updateState).not.toHaveBeenCalled();
  });

  it('arms the interval and records scheduler state when enabled', async () => {
    const { scheduler, state } = makeScheduler(
      { 'pipeline.onApi': true, 'pipeline.catchupOnStart': false },
      { last_success: pythonUtcIso() },
    );
    await scheduler.onModuleInit();
    expect(scheduler.isRunning()).toBe(true);
    expect(scheduler.nextRunIso()).toBeTruthy();
    expect(state.updateState).toHaveBeenCalledWith(
      expect.objectContaining({
        scheduler: 'running',
        status: 'idle',
        interval_seconds: 3600,
      }),
    );
    scheduler.shutdown();
    expect(scheduler.isRunning()).toBe(false);
  });

  it('accepts a native executor without a Python working directory', async () => {
    const { scheduler } = makeScheduler({
      'pipeline.onApi': true,
      'pipeline.executor': 'native',
      'pipeline.python.cwd': '',
    });
    const selfTest = await scheduler.selfTest();
    expect(selfTest.config_ok).toBe(true);
    expect(selfTest.errors.join(' ')).not.toContain('PIPELINE_PYTHON_CWD');
  });

  it('rejects a python executor when the Flask directory is missing', async () => {
    const { scheduler } = makeScheduler({
      'pipeline.onApi': true,
      'pipeline.executor': 'python',
      'pipeline.python.cwd': '',
    });
    const selfTest = await scheduler.selfTest();
    expect(selfTest.config_ok).toBe(false);
    expect(selfTest.errors.join(' ')).toContain('PIPELINE_PYTHON_CWD');
  });

  it('does not arm when the self-test fails (missing MONGODB_URI)', async () => {
    const { scheduler } = makeScheduler({
      'pipeline.onApi': true,
      'database.uri': '',
    });
    const selfTest = await scheduler.selfTest();
    expect(selfTest.config_ok).toBe(false);
    expect(selfTest.errors.join(' ')).toContain(
      'NEON_DATABASE_URL is required',
    );

    await scheduler.onModuleInit();
    expect(scheduler.isRunning()).toBe(false);
  });

  it('retries the self-test after a database failure and then arms', async () => {
    jest.useFakeTimers();
    try {
      const { scheduler, state } = makeScheduler(
        { 'pipeline.onApi': true, 'pipeline.catchupOnStart': false },
        { last_success: pythonUtcIso() },
      );
      state.pingDiagnostics
        .mockRejectedValueOnce(new Error('connection timeout'))
        .mockResolvedValue({ ok: true });

      await scheduler.onModuleInit();
      expect(scheduler.isRunning()).toBe(false);

      await jest.advanceTimersByTimeAsync(scheduler.selfTestRetryMs);
      expect(scheduler.isRunning()).toBe(true);
      scheduler.shutdown();
    } finally {
      jest.useRealTimers();
    }
  });

  it('skips catch-up when the last success is younger than one interval', async () => {
    const { scheduler, runner } = makeScheduler(
      {},
      {
        last_success: pythonUtcIso(new Date(Date.now() - 5 * 60 * 1000)),
      },
    );
    await expect(scheduler.catchUp()).resolves.toBe('skipped_fresh');
    expect(runner.run).not.toHaveBeenCalled();
  });

  it('runs catch-up through the canonical runner when data is stale', async () => {
    const { scheduler, runner } = makeScheduler(
      {},
      {
        last_success: pythonUtcIso(new Date(Date.now() - 6 * 60 * 60 * 1000)),
      },
    );
    await expect(scheduler.catchUp()).resolves.toBe('ran');
    expect(runner.run).toHaveBeenCalledTimes(1);
    expect(runner.run.mock.calls[0][0].trigger).toBe('catch_up');
  });

  it('runs catch-up when no success has ever been recorded', async () => {
    const { scheduler, runner } = makeScheduler({}, {});
    await expect(scheduler.catchUp()).resolves.toBe('ran');
    expect(runner.run).toHaveBeenCalledTimes(1);
  });

  it('treats a missing Groq key as a warning, not a start-blocking error', async () => {
    const saved = { ...process.env };
    for (const k of Object.keys(process.env)) {
      if (k.startsWith('GROQ_API_KEY')) delete process.env[k];
    }
    try {
      const { scheduler } = makeScheduler({ 'pipeline.onApi': true });
      const selfTest = await scheduler.selfTest();
      expect(selfTest.errors).toEqual([]);
      expect(selfTest.warnings.join(' ')).toContain('GROQ_API_KEY');
    } finally {
      process.env = saved;
    }
  });
});
