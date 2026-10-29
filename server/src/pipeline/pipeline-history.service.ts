import { Injectable, Logger } from '@nestjs/common';
import { Document, Filter, ObjectId } from 'mongodb';
import { DatabaseService } from '../database/database.service';
import { pythonUtcIso } from '../common/utils/iso-time';

export const HISTORY_COLLECTION = 'pipeline_history';

export interface PublicRun {
  id: string | null;
  run_id: string | null;
  trigger: string;
  trigger_raw: unknown;
  status: string;
  started_at: unknown;
  completed_at: unknown;
  duration_seconds: unknown;
  records_fetched: unknown;
  records_processed: number;
  records_inserted: unknown;
  duplicates: unknown;
  error_message: string | null;
  errors: unknown[];
  retry_count: number;
  parent_run_id: unknown;
}

export interface HistoryStats {
  successful: number;
  failed: number;
  skipped: number;
  running: number;
  total: number;
}

function intOr0(value: unknown): number {
  const n = parseInt(String(value ?? 0), 10);
  return Number.isFinite(n) ? n : 0;
}

/** Python `value or 0` — false/''/0/null all collapse to 0. */
function orZero(value: unknown): unknown {
  return value ? value : 0;
}

/**
 * Port of Flask `pipeline_state.record_history` plus the read/shape helpers in
 * `admin/fetch_service.py` (`_public_run`, `list_history`, `history_stats`).
 */
@Injectable()
export class PipelineHistoryService {
  private readonly logger = new Logger(PipelineHistoryService.name);
  private indexesReady = false;

  constructor(private readonly db: DatabaseService) {}

  private collection() {
    return this.db.collection(HISTORY_COLLECTION);
  }

  async ensureIndexes(): Promise<void> {
    if (this.indexesReady) return;
    await this.db.ensureConnected();
    try {
      await this.collection().createIndex({ start_time: -1 });
      await this.collection().createIndex({ status: 1 });
      await this.collection().createIndex({ run_id: 1 });
      await this.collection().createIndex({ trigger: 1 });
      this.indexesReady = true;
    } catch (err) {
      this.logger.warn(
        'pipeline_history index creation failed: ' +
          (err instanceof Error ? err.message : String(err)),
      );
    }
  }

  async record(record: Record<string, unknown>): Promise<string> {
    await this.ensureIndexes();
    const result = await this.collection().insertOne({
      ...record,
      recorded_at: pythonUtcIso(),
    });
    return String(result.insertedId);
  }

  /** Flask `_public_run`. */
  toPublicRun(doc: Document): PublicRun {
    const oid = doc._id;
    const errors = Array.isArray(doc.errors) ? doc.errors : [];
    let errMsg: string | null = null;
    if (errors.length) {
      errMsg = errors
        .slice(0, 5)
        .map((e) => String(e))
        .join('; ');
    } else if (doc.error_message) {
      errMsg = String(doc.error_message).slice(0, 500);
    }

    const trigger = String(doc.trigger || 'automatic').toLowerCase();
    let triggerLabel: string;
    if (['interval', 'catch_up', 'automatic'].includes(trigger)) {
      triggerLabel = 'automatic';
    } else if (trigger === 'manual' || trigger === 'retry') {
      triggerLabel = trigger;
    } else {
      triggerLabel = trigger;
    }

    let status = String(doc.status || 'unknown');
    if (status === 'failed' || status === 'error') status = 'failed';

    return {
      id: oid !== null && oid !== undefined ? String(oid) : null,
      run_id:
        (doc.run_id as string | undefined) ||
        (oid !== null && oid !== undefined ? String(oid) : null),
      trigger: triggerLabel,
      trigger_raw: doc.trigger ?? null,
      status,
      started_at: doc.start_time ?? null,
      completed_at: doc.finish_time ?? null,
      duration_seconds: doc.duration_seconds ?? null,
      records_fetched: orZero(doc.articles_fetched),
      records_processed:
        intOr0(doc.lokal_processed) +
        intOr0(doc.youtube_processed) +
        intOr0(doc.sakshi_processed),
      records_inserted: orZero(doc.inserted),
      duplicates: orZero(doc.duplicates),
      error_message: errMsg,
      errors: errors.slice(0, 20),
      retry_count: intOr0(doc.retry_count),
      parent_run_id: doc.parent_run_id ?? null,
    };
  }

  /** Flask `list_history` (same status/trigger aliasing and client-side `q`). */
  async list(options: {
    limit?: number;
    status?: string | null;
    trigger?: string | null;
    q?: string | null;
  }): Promise<PublicRun[]> {
    await this.ensureIndexes();
    const { limit = 50, status, trigger, q } = options;
    const query: Filter<Document> = {};

    if (status) {
      const st = status.toLowerCase();
      if (st === 'success') {
        query.status = 'success';
      } else if (st === 'failed') {
        query.status = { $in: ['failed', 'error', 'timeout'] };
      } else if (['skipped', 'running', 'timeout', 'cancelled'].includes(st)) {
        query.status = st;
      } else {
        query.status = status;
      }
    }

    if (trigger) {
      const tr = trigger.toLowerCase();
      if (tr === 'automatic') {
        query.trigger = { $in: ['interval', 'catch_up', 'automatic'] };
      } else if (tr === 'manual' || tr === 'retry') {
        query.trigger = tr;
      } else {
        query.trigger = trigger;
      }
    }

    const docs = await this.collection()
      .find(query)
      .sort({ start_time: -1 })
      .limit(Math.max(1, Math.min(limit, 200)))
      .toArray();

    let rows = docs.map((d) => this.toPublicRun(d));
    if (q) {
      const needle = q.toLowerCase();
      rows = rows.filter(
        (r) =>
          (r.error_message || '').toLowerCase().includes(needle) ||
          (r.run_id || '').toLowerCase().includes(needle) ||
          (r.status || '').toLowerCase().includes(needle),
      );
    }
    return rows;
  }

  /** Flask `get_run` — run_id first, then ObjectId fallback. */
  async getRun(runId: string): Promise<PublicRun | null> {
    await this.ensureIndexes();
    let doc = await this.collection().findOne({ run_id: runId });
    if (!doc) {
      try {
        doc = await this.collection().findOne({
          _id: new ObjectId(runId),
        });
      } catch {
        doc = null;
      }
    }
    return doc ? this.toPublicRun(doc) : null;
  }

  /** Flask `history_stats`. */
  async stats(): Promise<HistoryStats> {
    await this.ensureIndexes();
    const coll = this.collection();
    const [successful, failed, skipped, running] = await Promise.all([
      coll.countDocuments({ status: 'success' }),
      coll.countDocuments({ status: { $in: ['failed', 'error', 'timeout'] } }),
      coll.countDocuments({ status: 'skipped' }),
      coll.countDocuments({ status: 'running' }),
    ]);
    return {
      successful,
      failed,
      skipped,
      running,
      total: successful + failed + skipped + running,
    };
  }
}
