import { Injectable } from '@nestjs/common';
import { Document } from 'mongodb';
import { DatabaseService } from '../database.service';
import { ArticleRepository } from './article.repository';

const STATE_ID = 'pipeline';
const STATE_COLLECTION = 'scheduler_state';

@Injectable()
export class PipelineStateRepository {
  constructor(
    private readonly db: DatabaseService,
    private readonly articles: ArticleRepository,
  ) {}

  async getState(): Promise<Document> {
    const doc = await this.db
      .collection(STATE_COLLECTION)
      .findOne({ _id: STATE_ID });
    return doc || {};
  }

  /**
   * Matches Flask pipeline_state.get_data_revision():
   * max of scheduler_state timestamps and newest article timestamps.
   */
  async getDataRevision(): Promise<string | null> {
    const state = await this.getState();
    const candidates: string[] = [];
    for (const key of ['last_success', 'last_run', 'updated_at'] as const) {
      const value = state[key];
      if (value) candidates.push(String(value));
    }

    try {
      const newest = await this.articles.findNewestForRevision();
      if (newest) {
        for (const key of ['first_seen_at', 'last_updated_at'] as const) {
          const value = newest[key];
          if (value) candidates.push(String(value));
        }
      }
    } catch {
      // news must not fail if revision unavailable
    }

    if (!candidates.length) return null;
    return candidates.reduce((a, b) => (a > b ? a : b));
  }

  async pingDiagnostics(): Promise<{
    ok: boolean;
    latency_ms: number;
    database: string;
    articles_collection: string;
    articles_count: number;
  }> {
    const ping = await this.db.ping();
    return {
      ok: true,
      latency_ms: ping.latencyMs,
      database: this.db.dbName,
      articles_collection: this.db.articlesCollectionName,
      articles_count: await this.articles.count(),
    };
  }
}
