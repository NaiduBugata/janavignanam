import { Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { PipelineLockService } from './pipeline-lock.service';
import { PipelineStateService } from './pipeline-state.service';
import { PipelineHistoryService } from './pipeline-history.service';
import { ConfigService } from '@nestjs/config';
import { PythonBridgeService, emptyStats } from './python-bridge.service';
import { CombinedPipelineService } from './native/combined-pipeline.service';
import { pythonUtcIso, round3 } from '../common/utils/iso-time';

export type RunTrigger = 'manual' | 'retry' | 'interval' | 'catch_up';

export interface RunRequest {
  trigger: RunTrigger;
  runId?: string;
  parentRunId?: string | null;
  /** Supplier for `next_run` so the state document keeps the scheduler view. */
  nextRunIso?: () => string | null;
}

export interface RunResult {
  runId: string;
  status: 'success' | 'failed' | 'skipped';
  skippedReason?: 'local_gate' | 'lock_held';
  durationSeconds: number;
  inserted: number;
  duplicates: number;
  fetched: number;
  errors: string[];
}

/** Flask `admin/fetch_service.new_run_id()`. */
export function newRunId(now: Date = new Date()): string {
  const stamp = now
    .toISOString()
    .replace(/[-:]/g, '')
    .replace('T', '_')
    .slice(0, 15);
  return `fetch_${stamp}_${randomBytes(4).toString('hex')}`;
}

/**
 * THE CANONICAL PIPELINE ENTRY POINT.
 *
 * Every path — admin manual fetch, admin retry, `/api/pipeline/run-now`,
 * scheduler interval tick and startup catch-up — goes through `run()`. There is
 * no second execution path, which is what makes the single-writer guarantee
 * checkable.
 *
 * Port of Flask `pipeline_scheduler._job`, with pipeline execution delegated to
 * the Python subprocess (Option B) instead of an in-process `run_combined_cycle`.
 */
@Injectable()
export class PipelineRunnerService {
  private readonly logger = new Logger(PipelineRunnerService.name);

  /**
   * In-process gate. Belt-and-suspenders only; the MongoDB lock is the real
   * cross-process guarantee (Flask keeps the same two-layer arrangement).
   */
  private gateHeld = false;

  constructor(
    private readonly lock: PipelineLockService,
    private readonly state: PipelineStateService,
    private readonly history: PipelineHistoryService,
    private readonly python: PythonBridgeService,
    private readonly nativePipeline: CombinedPipelineService,
    private readonly config: ConfigService,
  ) {}

  get busy(): boolean {
    return this.gateHeld;
  }

  async run(request: RunRequest): Promise<RunResult> {
    const trigger = request.trigger;
    const parentRunId = request.parentRunId ?? null;
    const started = new Date();
    const startedIso = pythonUtcIso(started);

    if (this.gateHeld) {
      const runId = request.runId || `skip_gate_${this.compactStamp(started)}`;
      this.logger.log(
        'Pipeline job skipped: another cycle is already in progress (local gate).',
      );
      await this.safeRecordSkip(
        runId,
        startedIso,
        trigger,
        parentRunId,
        'skipped_local_gate',
      );
      return this.skipResult(runId, 'local_gate', 'skipped_local_gate');
    }
    this.gateHeld = true;

    let owner: string | null = null;
    let runId = request.runId || null;
    if (!runId) {
      try {
        const existing = await this.state.getState();
        runId = (existing.pending_run_id as string | undefined) || null;
      } catch {
        runId = null;
      }
    }
    if (!runId) {
      runId = `fetch_${this.compactStamp(started)}_${trigger}`;
    }

    let stats = emptyStats();
    let status: 'success' | 'failed' = 'failed';
    const errors: string[] = [];

    try {
      owner = await this.lock.acquire();
      if (!owner) {
        this.logger.log(
          'Pipeline job skipped: distributed lock held by another instance.',
        );
        await this.safeRecordSkip(
          runId,
          startedIso,
          trigger,
          parentRunId,
          'skipped_lock_held',
        );
        return this.skipResult(runId, 'lock_held', 'skipped_lock_held');
      }

      this.logger.log(
        `[FETCH_START] run_id=${runId} trigger=${trigger} owner=${owner}`,
      );

      await this.state.updateState({
        last_run: startedIso,
        status: 'running',
        trigger,
        current_run_id: runId,
      });

      const executor = (
        this.config.get<string>('pipeline.executor') || 'native'
      ).toLowerCase();
      const result =
        executor === 'python'
          ? await this.python.runCombinedOnce()
          : await this.nativePipeline.runCombinedOnce();
      stats = result.stats;
      errors.push(...stats.errors);

      const finished = new Date();
      const finishedIso = pythonUtcIso(finished);
      const duration = round3((finished.getTime() - started.getTime()) / 1000);
      const nextRun = request.nextRunIso ? request.nextRunIso() : null;

      if (result.exitCode === 0) {
        status = 'success';
        await this.state.updateState({
          last_run: startedIso,
          last_success: finishedIso,
          status: 'success',
          duration_seconds: duration,
          articles_inserted: stats.inserted,
          next_run: nextRun,
          last_errors: errors.slice(0, 20),
          current_run_id: null,
          pending_run_id: null,
        });
        this.logger.log(
          `[FETCH_SUCCESS] run_id=${runId} duration=${String(duration)}s ` +
            `inserted=${String(stats.inserted)} duplicates=${String(stats.duplicates)}`,
        );
      } else {
        status = 'failed';
        await this.state.updateState({
          last_run: startedIso,
          last_failure: finishedIso,
          status: 'failed',
          duration_seconds: duration,
          articles_inserted: stats.inserted,
          next_run: nextRun,
          last_errors: errors.slice(0, 20),
          current_run_id: null,
          pending_run_id: null,
        });
        this.logger.error(
          `[FETCH_FAILED] run_id=${runId} duration=${String(duration)}s errors=${errors.join('; ')}`,
        );
      }

      await this.history.record({
        run_id: runId,
        start_time: startedIso,
        finish_time: finishedIso,
        duration_seconds: duration,
        articles_fetched: stats.articles_fetched,
        duplicates: stats.duplicates,
        inserted: stats.inserted,
        lokal_processed: stats.lokal_processed,
        youtube_processed: stats.youtube_processed,
        sakshi_processed: stats.sakshi_processed,
        errors: errors.slice(0, 50),
        status,
        trigger,
        parent_run_id: parentRunId,
        // Option B provenance so history rows are self-describing.
        executor:
          (this.config.get<string>('pipeline.executor') || 'native') ===
          'python'
            ? 'python_subprocess'
            : 'nestjs',
        executor_command: result.command,
        executor_stats_parsed: result.parsed,
      });

      const sourceErrors = (name: string) =>
        errors
          .filter((e) => e.startsWith(`${name}_`) || e.startsWith(`${name}:`))
          .slice(0, 10);
      await this.state.updateState({
        last_sakshi_run: finishedIso,
        last_sakshi_articles: stats.sakshi_processed,
        last_lokal_articles: stats.lokal_processed,
        last_youtube_articles: stats.youtube_processed,
        lokal_last_errors: sourceErrors('lokal'),
        youtube_last_errors: sourceErrors('youtube'),
        sakshi_last_errors: sourceErrors('sakshi'),
      });

      return {
        runId,
        status,
        durationSeconds: duration,
        inserted: stats.inserted,
        duplicates: stats.duplicates,
        fetched: stats.articles_fetched,
        errors,
      };
    } catch (err) {
      const finished = new Date();
      const finishedIso = pythonUtcIso(finished);
      const duration = round3((finished.getTime() - started.getTime()) / 1000);
      const message = err instanceof Error ? err.message : String(err);
      const stack = err instanceof Error ? err.stack || '' : '';
      this.logger.error(`Pipeline cycle crashed: ${message}`, stack);
      errors.push(message);
      try {
        await this.state.updateState({
          last_run: startedIso,
          last_failure: finishedIso,
          status: 'failed',
          duration_seconds: duration,
          next_run: request.nextRunIso ? request.nextRunIso() : null,
          last_errors: errors.slice(0, 20),
        });
        await this.history.record({
          run_id: runId,
          start_time: startedIso,
          finish_time: finishedIso,
          duration_seconds: duration,
          articles_fetched: stats.articles_fetched,
          duplicates: stats.duplicates,
          inserted: stats.inserted,
          lokal_processed: stats.lokal_processed,
          youtube_processed: stats.youtube_processed,
          sakshi_processed: stats.sakshi_processed,
          errors: errors.slice(0, 50),
          status: 'failed',
          trigger,
          parent_run_id: parentRunId,
          error_stack: stack.slice(0, 2000),
          executor: 'python_subprocess',
        });
      } catch (persistErr) {
        this.logger.error(
          'Failed to persist pipeline failure state: ' +
            (persistErr instanceof Error
              ? persistErr.message
              : String(persistErr)),
        );
      }
      try {
        await this.nativePipeline.alertFailure([
          `pipeline_crashed: ${message.slice(0, 200)}`,
        ]);
      } catch (alertErr) {
        this.logger.error(
          'Failed to send pipeline crash alert: ' +
            (alertErr instanceof Error ? alertErr.message : String(alertErr)),
        );
      }
      return {
        runId,
        status: 'failed',
        durationSeconds: duration,
        inserted: stats.inserted,
        duplicates: stats.duplicates,
        fetched: stats.articles_fetched,
        errors,
      };
    } finally {
      if (owner) {
        try {
          await this.lock.release(owner);
        } catch (releaseErr) {
          this.logger.error(
            `Failed to release pipeline lock for owner=${owner}: ` +
              (releaseErr instanceof Error
                ? releaseErr.message
                : String(releaseErr)),
          );
        }
      }
      this.gateHeld = false;
    }
  }

  /** Fire-and-forget wrapper (Flask `run_now` started a daemon thread). */
  runDetached(request: RunRequest): void {
    void this.run(request).catch((err) => {
      this.logger.error(
        'Detached pipeline run failed: ' +
          (err instanceof Error ? err.message : String(err)),
      );
    });
  }

  private skipResult(
    runId: string,
    reason: 'local_gate' | 'lock_held',
    errorCode: string,
  ): RunResult {
    return {
      runId,
      status: 'skipped',
      skippedReason: reason,
      durationSeconds: 0,
      inserted: 0,
      duplicates: 0,
      fetched: 0,
      errors: [errorCode],
    };
  }

  private async safeRecordSkip(
    runId: string,
    startedIso: string,
    trigger: string,
    parentRunId: string | null,
    errorCode: string,
  ): Promise<void> {
    try {
      await this.history.record({
        run_id: runId,
        start_time: startedIso,
        finish_time: pythonUtcIso(),
        duration_seconds: 0,
        articles_fetched: 0,
        duplicates: 0,
        inserted: 0,
        errors: [errorCode],
        status: 'skipped',
        trigger,
        parent_run_id: parentRunId,
      });
    } catch {
      /* Flask also swallows history failures on the skip path */
    }
  }

  /** `YYYYmmdd_HHMMSS` in UTC, matching Flask's strftime usage. */
  private compactStamp(date: Date): string {
    return date
      .toISOString()
      .replace(/[-:]/g, '')
      .replace('T', '_')
      .slice(0, 15);
  }
}
