import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Document } from 'mongodb';
import { DatabaseService } from '../database/database.service';
import { ArticleRepository } from '../database/repositories/article.repository';
import { PipelineStateRepository } from '../database/repositories/pipeline-state.repository';
import { pythonUtcIso } from '../common/utils/iso-time';

export const STATE_COLLECTION = 'scheduler_state';

/**
 * Port of Flask `pipeline_state.get_state` / `update_state`.
 * Same collection (`scheduler_state`) and same `_id` ("pipeline"), so Flask and
 * Nest observe one another's state during migration.
 */
@Injectable()
export class PipelineStateService {
  constructor(
    private readonly db: DatabaseService,
    private readonly config: ConfigService,
    private readonly articles: ArticleRepository,
    private readonly stateRepo: PipelineStateRepository,
  ) {}

  private get stateId(): string {
    return this.config.get<string>('pipeline.stateId') || 'pipeline';
  }

  private collection() {
    return this.db.collection(STATE_COLLECTION);
  }

  async getState(): Promise<Document> {
    await this.db.ensureConnected();
    const doc = await this.collection().findOne({
      _id: this.stateId,
    });
    return doc ? { ...doc } : { _id: this.stateId };
  }

  async updateState(fields: Record<string, unknown>): Promise<Document> {
    await this.db.ensureConnected();
    const now = pythonUtcIso();
    await this.collection().updateOne(
      { _id: this.stateId },
      {
        $set: { ...fields, updated_at: now },
        $setOnInsert: { created_at: now },
      },
      { upsert: true },
    );
    return this.getState();
  }

  async getDataRevision(): Promise<string | null> {
    return this.stateRepo.getDataRevision();
  }

  async articleCount(): Promise<number> {
    return this.articles.count();
  }

  async pingDiagnostics() {
    return this.stateRepo.pingDiagnostics();
  }
}
