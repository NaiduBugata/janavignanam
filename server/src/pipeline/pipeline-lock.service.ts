import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'node:crypto';
import { hostname } from 'node:os';
import { Document } from 'mongodb';
import { DatabaseService } from '../database/database.service';
import { pythonNaiveIso } from '../common/utils/iso-time';

export const LOCK_COLLECTION = 'pipeline_lock';

export interface LockSummary {
  held: boolean;
  owner_present: boolean;
  expires_at: string | null;
  acquired_at: string | null;
}

/**
 * Distributed pipeline lock — port of Flask `pipeline_state.acquire_lock` /
 * `release_lock` / `get_lock_summary`.
 *
 * This is a MongoDB atomic lock on `pipeline_lock`, NOT an in-process boolean,
 * so Nest and any surviving Flask writer cannot both run a cycle.
 *
 * Staleness: Flask creates a *plain* (non-TTL) index on `expires_at` and frees
 * a stale lock via the `expires_at <= now` predicate in the acquire filter. A
 * Mongo TTL index would delete the document instead of releasing ownership, and
 * would also collide with Flask's existing index options, so we mirror Flask.
 */
@Injectable()
export class PipelineLockService {
  private readonly logger = new Logger(PipelineLockService.name);
  private indexesReady = false;

  constructor(
    private readonly db: DatabaseService,
    private readonly config: ConfigService,
  ) {}

  private get stateId(): string {
    return this.config.get<string>('pipeline.stateId') || 'pipeline';
  }

  private get defaultTtlSeconds(): number {
    return this.config.get<number>('pipeline.lockTtlSeconds') || 45 * 60;
  }

  private collection() {
    return this.db.collection(LOCK_COLLECTION);
  }

  async ensureIndexes(): Promise<void> {
    if (this.indexesReady) return;
    await this.db.ensureConnected();
    try {
      await this.collection().createIndex({ expires_at: 1 });
      this.indexesReady = true;
    } catch (err) {
      this.logger.warn(
        'pipeline_lock index creation failed: ' +
          (err instanceof Error ? err.message : String(err)),
      );
    }
  }

  newOwner(): string {
    return `${hostname() || 'host'}:${randomBytes(6).toString('hex')}`;
  }

  /**
   * Atomically acquire the lock. Returns the owner token, or null when another
   * live holder owns it.
   */
  async acquire(owner?: string, ttlSeconds?: number): Promise<string | null> {
    await this.ensureIndexes();
    const ownerToken = owner || this.newOwner();
    const ttl = ttlSeconds ?? this.defaultTtlSeconds;
    const now = new Date();
    const payload = {
      owner: ownerToken,
      acquired_at: now,
      expires_at: new Date(now.getTime() + ttl * 1000),
      updated_at: now,
    };

    const doc = await this.collection().findOneAndUpdate(
      {
        _id: this.stateId,
        $or: [
          { owner: { $exists: false } },
          { owner: null },
          { expires_at: { $lte: now } },
        ],
      },
      { $set: payload },
      { returnDocument: 'after' },
    );

    if (doc && doc.owner === ownerToken) return ownerToken;

    try {
      await this.collection().insertOne({
        _id: this.stateId,
        ...payload,
      });
      return ownerToken;
    } catch (err) {
      const code = (err as { code?: number }).code;
      if (code === 11000) return null; // DuplicateKeyError -> lock is held
      throw err;
    }
  }

  /**
   * Drop a lock acquired by a previous process on this computer. A watch restart
   * kills the fetch but leaves the database lock until its 45-minute expiry,
   * which blocks every new fetch with "already running".
   */
  async releaseLocalOrphan(): Promise<boolean> {
    await this.db.ensureConnected();
    const doc = await this.collection().findOne({
      _id: this.stateId,
    });
    const owner = typeof doc?.owner === 'string' ? doc.owner : '';
    const host = hostname() || 'host';
    if (!owner.startsWith(`${host}:`)) return false;
    const released = await this.release(owner);
    if (released) {
      this.logger.warn(`Released orphaned pipeline lock held by ${owner}`);
    }
    return released;
  }

  /** Release only if `owner` still holds the lock. */
  async release(owner: string): Promise<boolean> {
    await this.db.ensureConnected();
    const now = new Date();
    const result = await this.collection().updateOne(
      { _id: this.stateId, owner },
      { $set: { owner: null, released_at: now, updated_at: now } },
    );
    return result.modifiedCount > 0;
  }

  async summary(): Promise<LockSummary> {
    await this.ensureIndexes();
    const doc: Document =
      (await this.collection().findOne({
        _id: this.stateId,
      })) || {};
    const expires = doc.expires_at instanceof Date ? doc.expires_at : null;
    const acquired = doc.acquired_at instanceof Date ? doc.acquired_at : null;
    return {
      held: Boolean(doc.owner) && Boolean(expires && expires > new Date()),
      owner_present: Boolean(doc.owner),
      expires_at: expires ? pythonNaiveIso(expires) : null,
      acquired_at: acquired ? pythonNaiveIso(acquired) : null,
    };
  }
}
