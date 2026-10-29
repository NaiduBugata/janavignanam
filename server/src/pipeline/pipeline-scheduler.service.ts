import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { PipelineRunnerService } from './pipeline-runner.service';
import { PipelineStateService } from './pipeline-state.service';
import { PipelineHistoryService } from './pipeline-history.service';
import { PipelineLockService } from './pipeline-lock.service';
import { agoSeconds } from '../common/utils/iso-time';

export interface SelfTestResult {
  config_ok: boolean;
  mongo_ok: boolean;
  indexes_ok: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Port of Flask `pipeline_scheduler` start/interval/catch-up, on
 * `@nestjs/schedule`'s SchedulerRegistry.
 *
 * SINGLE WRITER RULE: enabling `PIPELINE_ON_API=true` here means the Flask
 * scheduler MUST be disabled (`PIPELINE_ON_API=false` in the Flask env). The
 * MongoDB lock prevents corrupted double-runs, but two schedulers would still
 * fight over `scheduler_state` and burn Groq quota on skipped cycles.
 */
@Injectable()
export class PipelineSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PipelineSchedulerService.name);
  private readonly intervalName = 'news_pipeline';

  private running = false;
  private nextRunAt: Date | null = null;
  private intervalRegistered = false;
  private retryTimer: NodeJS.Timeout | null = null;
  readonly selfTestRetryMs = 60_000;

  constructor(
    private readonly config: ConfigService,
    private readonly registry: SchedulerRegistry,
    private readonly runner: PipelineRunnerService,
    private readonly state: PipelineStateService,
    private readonly history: PipelineHistoryService,
    private readonly lock: PipelineLockService,
  ) {}

  isRunning(): boolean {
    return this.running;
  }

  get intervalSeconds(): number {
    const hours = this.config.get<number>('pipeline.intervalHours') || 1;
    return Math.max(1, Math.round(hours * 3600));
  }

  nextRunIso(): string | null {
    if (!this.running || !this.nextRunAt) return null;
    return this.nextRunAt.toISOString();
  }

  async onModuleInit(): Promise<void> {
    const onApi = this.config.get<boolean>('pipeline.onApi');
    if (!onApi) {
      this.logger.log(
        'PIPELINE_ON_API is false — Nest scheduler stays off (Flask remains the writer).',
      );
      return;
    }
    await this.arm();
  }

  /** Starts the interval once the self-test passes. A database failure is retried; a config error is not. */
  private async arm(): Promise<void> {
    const selfTest = await this.selfTest();
    this.logger.log(`Pipeline self-test: ${JSON.stringify(selfTest)}`);
    for (const warning of selfTest.warnings) this.logger.warn(warning);
    if (selfTest.errors.length) {
      for (const err of selfTest.errors) {
        this.logger.error(`Scheduler start aborted: ${err}`);
      }
      if (selfTest.config_ok) {
        this.logger.warn(
          `Retrying the scheduler self-test in ${String(this.selfTestRetryMs / 1000)}s.`,
        );
        this.retryTimer = setTimeout(() => {
          this.retryTimer = null;
          void this.arm();
        }, this.selfTestRetryMs);
        this.retryTimer.unref?.();
      }
      return;
    }

    this.start();

    let releasedOrphan = false;
    try {
      releasedOrphan = await this.lock.releaseLocalOrphan();
      if (releasedOrphan) {
        this.logger.warn(
          'Released a news-fetch lock left behind when this process restarted. A new fetch can start.',
        );
      }
    } catch (err) {
      this.logger.warn(
        'Could not check the news-fetch lock: ' +
          (err instanceof Error ? err.message : String(err)),
      );
    }

    try {
      await this.state.updateState({
        status: 'idle',
        next_run: this.nextRunIso(),
        scheduler: 'running',
        interval_seconds: this.intervalSeconds,
        ...(releasedOrphan
          ? { current_run_id: null, pending_run_id: null }
          : {}),
      });
    } catch (err) {
      this.logger.warn(
        'Could not persist scheduler startup state: ' +
          (err instanceof Error ? err.message : String(err)),
      );
    }

    this.logger.log(
      `Scheduler initialized. interval=${String(this.intervalSeconds)}s ` +
        `(${String(this.intervalSeconds / 3600)}h) next_run=${String(this.nextRunIso())}`,
    );

    if (this.config.get<boolean>('pipeline.catchupOnStart')) {
      // Background; must never block Nest bootstrap.
      void this.catchUp();
    }
  }

  onModuleDestroy(): void {
    this.shutdown();
  }

  /** Register the recurring tick. Idempotent. */
  start(): void {
    if (this.intervalRegistered) {
      this.logger.log('Scheduler already running.');
      return;
    }
    const ms = this.intervalSeconds * 1000;
    const handle = setInterval(() => {
      void this.tick();
    }, ms);
    this.registry.addInterval(this.intervalName, handle);
    this.intervalRegistered = true;
    this.running = true;
    this.nextRunAt = new Date(Date.now() + ms);
  }

  shutdown(): void {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    if (this.intervalRegistered) {
      try {
        this.registry.deleteInterval(this.intervalName);
      } catch {
        /* already removed */
      }
      this.intervalRegistered = false;
      this.logger.log('Pipeline scheduler stopped.');
    }
    this.running = false;
    this.nextRunAt = null;
  }

  /** Interval tick — same canonical runner, same lock. */
  private async tick(): Promise<void> {
    this.nextRunAt = new Date(Date.now() + this.intervalSeconds * 1000);
    try {
      await this.runner.run({
        trigger: 'interval',
        nextRunIso: () => this.nextRunIso(),
      });
    } catch (err) {
      // Scheduler must never die.
      this.logger.error(
        'Scheduled pipeline cycle raised: ' +
          (err instanceof Error ? err.message : String(err)),
      );
    }
  }

  /**
   * Flask `_catch_up`: run once on startup when last_success is missing or
   * older than one interval. Uses the same lock + runner, so it can never
   * double-fire with an interval tick.
   */
  async catchUp(): Promise<'ran' | 'skipped_fresh' | 'error'> {
    try {
      const state = await this.state.getState();
      const age = agoSeconds(state.last_success);
      if (age !== null && age < this.intervalSeconds) {
        this.logger.log(
          `Catch-up skipped: last successful run was ${(age / 60).toFixed(0)} min ago (< interval).`,
        );
        return 'skipped_fresh';
      }
      this.logger.log('Catch-up: running pipeline cycle on startup.');
      await this.runner.run({
        trigger: 'catch_up',
        nextRunIso: () => this.nextRunIso(),
      });
      return 'ran';
    } catch (err) {
      this.logger.error(
        'Catch-up failed: ' +
          (err instanceof Error ? err.message : String(err)),
      );
      return 'error';
    }
  }

  /**
   * Mirrors Flask `run_self_test` for the parts Nest owns. A missing Groq key
   * is a warning: the native cycle analyzes articles itself and fails that
   * step only when a cycle actually runs. The Python working directory is
   * required only when PIPELINE_EXECUTOR=python.
   */
  async selfTest(): Promise<SelfTestResult> {
    const result: SelfTestResult = {
      config_ok: false,
      mongo_ok: false,
      indexes_ok: false,
      errors: [],
      warnings: [],
    };

    const hours = this.config.get<number>('pipeline.intervalHours') || 0;
    if (hours <= 0) result.errors.push('PIPELINE_INTERVAL_HOURS must be > 0');
    if (!(this.config.get<string>('database.uri') || '').trim()) {
      result.errors.push(
        'NEON_DATABASE_URL is required when the pipeline scheduler runs',
      );
    }
    if (!this.discoverGroqKeys().length) {
      result.warnings.push(
        'No GROQ_API_KEY / GROQ_API_KEY_N found. A native cycle cannot analyze articles until one is set.',
      );
    }
    const executor = (
      this.config.get<string>('pipeline.executor') || 'native'
    ).toLowerCase();
    const pythonCwd = this.config.get<string>('pipeline.python.cwd') || '';
    if (executor === 'python' && !pythonCwd) {
      result.errors.push(
        'PIPELINE_PYTHON_CWD could not be resolved (the python executor needs the Flask server/ directory)',
      );
    }
    result.config_ok = result.errors.length === 0;
    if (!result.config_ok) return result;

    try {
      const ping = await this.state.pingDiagnostics();
      result.mongo_ok = Boolean(ping.ok);
      await this.history.ensureIndexes();
      await this.lock.ensureIndexes();
      result.indexes_ok = true;
    } catch (err) {
      result.errors.push(
        `Mongo self-test failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      result.mongo_ok = false;
      result.indexes_ok = false;
    }
    return result;
  }

  /** Flask `pipeline_config.discover_groq_keys` (count only; values never logged). */
  private discoverGroqKeys(): string[] {
    const numbered: Array<[number, string]> = [];
    for (const [key, value] of Object.entries(process.env)) {
      const match = /^GROQ_API_KEY_(\d+)$/.exec(key);
      if (match && (value || '').trim()) {
        numbered.push([parseInt(match[1], 10), (value || '').trim()]);
      }
    }
    numbered.sort((a, b) => a[0] - b[0]);
    const keys = numbered.map(([, v]) => v);
    for (const alt of ['GROQ_API_KEY', 'GROQ_API_KEYS']) {
      const raw = (process.env[alt] || '').trim();
      if (!raw) continue;
      if (raw.includes(',')) {
        keys.push(
          ...raw
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
        );
      } else {
        keys.push(raw);
      }
    }
    return [...new Set(keys.filter(Boolean))];
  }
}
