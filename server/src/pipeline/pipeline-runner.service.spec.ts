import { PipelineRunnerService, newRunId } from './pipeline-runner.service';
import { PipelineLockService } from './pipeline-lock.service';
import { PipelineStateService } from './pipeline-state.service';
import { PipelineHistoryService } from './pipeline-history.service';
import { ConfigService } from '@nestjs/config';
import { PythonBridgeService, emptyStats } from './python-bridge.service';
import { CombinedPipelineService } from './native/combined-pipeline.service';

interface Harness {
  runner: PipelineRunnerService;
  lock: { acquire: jest.Mock; release: jest.Mock };
  state: { getState: jest.Mock; updateState: jest.Mock };
  history: { record: jest.Mock };
  python: { runCombinedOnce: jest.Mock };
  native: { alertFailure: jest.Mock };
  concurrentPythonRuns: () => number;
}

function makeHarness(
  options: { exitCode?: number; holdMs?: number; lockHeld?: boolean } = {},
): Harness {
  const { exitCode = 0, holdMs = 10, lockHeld = false } = options;

  let inFlight = 0;
  let maxInFlight = 0;
  let owned = false;

  const lock = {
    acquire: jest.fn(async () => {
      if (lockHeld || owned) return null;
      owned = true;
      return 'owner-1';
    }),
    release: jest.fn(async () => {
      owned = false;
      return true;
    }),
  };
  const state = {
    getState: jest.fn().mockResolvedValue({}),
    updateState: jest.fn().mockResolvedValue({}),
  };
  const history = { record: jest.fn().mockResolvedValue('hid') };
  const python = {
    runCombinedOnce: jest.fn(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, holdMs));
      inFlight -= 1;
      const stats = emptyStats();
      stats.inserted = 3;
      stats.duplicates = 1;
      stats.articles_fetched = 9;
      stats.sakshi_processed = 2;
      if (exitCode !== 0)
        stats.errors.push(`combined_cycle_exit_code=${exitCode}`);
      return {
        exitCode,
        stats,
        timedOut: false,
        parsed: true,
        outputTail: '',
        command: 'python run_all_pipelines.py --once',
      };
    }),
  };

  const config = {
    get: (key: string) => (key === 'pipeline.executor' ? 'python' : undefined),
  };
  const native = {
    runCombinedOnce: jest.fn(),
    alertFailure: jest.fn().mockResolvedValue(undefined),
  };
  const runner = new PipelineRunnerService(
    lock as unknown as PipelineLockService,
    state as unknown as PipelineStateService,
    history as unknown as PipelineHistoryService,
    python as unknown as PythonBridgeService,
    native as unknown as CombinedPipelineService,
    config as unknown as ConfigService,
  );

  return {
    runner,
    lock,
    state,
    history,
    python,
    native,
    concurrentPythonRuns: () => maxInFlight,
  };
}

describe('PipelineRunnerService (canonical single-writer runner)', () => {
  it('runs one Python cycle and records success state + history', async () => {
    const h = makeHarness();
    const result = await h.runner.run({ trigger: 'manual', runId: 'run-1' });

    expect(result.status).toBe('success');
    expect(result.runId).toBe('run-1');
    expect(result.inserted).toBe(3);
    expect(h.python.runCombinedOnce).toHaveBeenCalledTimes(1);
    expect(h.lock.acquire).toHaveBeenCalledTimes(1);
    expect(h.lock.release).toHaveBeenCalledWith('owner-1');

    const running = h.state.updateState.mock.calls[0][0];
    expect(running.status).toBe('running');
    expect(running.current_run_id).toBe('run-1');

    const success = h.state.updateState.mock.calls[1][0];
    expect(success.status).toBe('success');
    expect(success.articles_inserted).toBe(3);
    expect(success.last_errors).toEqual([]);
    expect(success.pending_run_id).toBeNull();
    // Flask writes +00:00-suffixed ISO strings; string-max data_revision depends on it.
    expect(String(success.last_success)).toMatch(/\+00:00$/);

    const row = h.history.record.mock.calls[0][0];
    expect(row).toMatchObject({
      run_id: 'run-1',
      status: 'success',
      trigger: 'manual',
      inserted: 3,
      duplicates: 1,
      articles_fetched: 9,
      executor: 'python_subprocess',
    });
  });

  it('marks the run failed on a non-zero Python exit code', async () => {
    const h = makeHarness({ exitCode: 1 });
    const result = await h.runner.run({ trigger: 'interval' });

    expect(result.status).toBe('failed');
    expect(result.errors).toContain('combined_cycle_exit_code=1');
    const failed = h.state.updateState.mock.calls[1][0];
    expect(failed.status).toBe('failed');
    expect(failed.last_failure).toBeTruthy();
    expect(h.lock.release).toHaveBeenCalled();
  });

  it('never runs two cycles at once (in-process gate)', async () => {
    const h = makeHarness({ holdMs: 40 });
    const [first, second] = await Promise.all([
      h.runner.run({ trigger: 'interval' }),
      h.runner.run({ trigger: 'manual' }),
    ]);

    expect(h.concurrentPythonRuns()).toBe(1);
    expect(h.python.runCombinedOnce).toHaveBeenCalledTimes(1);
    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual(['skipped', 'success']);

    const skipped = [first, second].find((r) => r.status === 'skipped')!;
    expect(skipped.skippedReason).toBe('local_gate');
    expect(skipped.errors).toEqual(['skipped_local_gate']);
  });

  it('skips and records history when the Mongo lock is held elsewhere', async () => {
    const h = makeHarness({ lockHeld: true });
    const result = await h.runner.run({ trigger: 'catch_up', runId: 'run-x' });

    expect(result.status).toBe('skipped');
    expect(result.skippedReason).toBe('lock_held');
    expect(h.python.runCombinedOnce).not.toHaveBeenCalled();
    expect(h.lock.release).not.toHaveBeenCalled();
    expect(h.history.record.mock.calls[0][0]).toMatchObject({
      run_id: 'run-x',
      status: 'skipped',
      trigger: 'catch_up',
      errors: ['skipped_lock_held'],
    });
  });

  it('releases the lock and records failure when the bridge throws', async () => {
    const h = makeHarness();
    h.python.runCombinedOnce.mockRejectedValueOnce(new Error('spawn exploded'));
    const result = await h.runner.run({ trigger: 'manual', runId: 'boom' });

    expect(result.status).toBe('failed');
    expect(result.errors).toContain('spawn exploded');
    expect(h.lock.release).toHaveBeenCalledWith('owner-1');
    expect(h.runner.busy).toBe(false);
    expect(h.native.alertFailure).toHaveBeenCalledWith([
      'pipeline_crashed: spawn exploded',
    ]);
  });

  it('still finishes a crashed run when the crash alert itself fails', async () => {
    const h = makeHarness();
    h.python.runCombinedOnce.mockRejectedValueOnce(new Error('db down'));
    h.native.alertFailure.mockRejectedValueOnce(new Error('resend down'));
    const result = await h.runner.run({ trigger: 'interval' });
    expect(result.status).toBe('failed');
    expect(h.runner.busy).toBe(false);
  });

  it('adopts pending_run_id from state when no runId is supplied', async () => {
    const h = makeHarness();
    h.state.getState.mockResolvedValueOnce({ pending_run_id: 'pending-7' });
    const result = await h.runner.run({ trigger: 'interval' });
    expect(result.runId).toBe('pending-7');
  });

  it('generates Flask-shaped run ids', () => {
    const id = newRunId(new Date('2026-09-26T13:25:00Z'));
    expect(id).toMatch(/^fetch_20260926_132500_[0-9a-f]{8}$/);
  });
});
