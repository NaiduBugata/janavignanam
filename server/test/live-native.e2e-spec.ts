/**
 * Controlled live native cycle. Skipped unless LIVE_PIPELINE=1.
 * Does not delete articles. Restores scheduler_state afterwards.
 */
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { CombinedPipelineService } from '../src/pipeline/native/combined-pipeline.service';
import { PipelineStateService } from '../src/pipeline/pipeline-state.service';
import { DatabaseService } from '../src/database/database.service';

const live = process.env.LIVE_PIPELINE === '1';

(live ? describe : describe.skip)('live native combined cycle', () => {
  let app: INestApplication;
  let snapshot: Record<string, unknown> = {};

  beforeAll(async () => {
    process.env.PIPELINE_EXECUTOR = 'native';
    process.env.PIPELINE_ON_API = 'false';
    process.env.PIPELINE_CATCHUP_ON_START = 'false';
    process.env.PIPELINE_MAX_ANALYZE = '1';
    process.env.YOUTUBE_MAX_RESULTS_PER_KEYWORD = '1';
    process.env.YOUTUBE_MAX_NEW_PER_RUN = '1';
    process.env.SAKSHI_MAX_ARTICLES_PER_RUN = '1';

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    const state = app.get(PipelineStateService);
    snapshot = { ...(await state.getState()) };
  }, 60000);

  afterAll(async () => {
    if (!app) return;
    const state = app.get(PipelineStateService);
    const restore: Record<string, unknown> = {};
    for (const key of [
      'status',
      'last_run',
      'last_success',
      'last_failure',
      'pending_run_id',
      'current_run_id',
    ]) {
      if (key in snapshot) restore[key] = snapshot[key];
    }
    if (Object.keys(restore).length) await state.updateState(restore);
    await app.close();
  }, 60000);

  it('collects, analyzes at most one article, and upserts', async () => {
    const db = app.get(DatabaseService);
    const before = await db
      .collection(db.articlesCollectionName)
      .countDocuments();
    const cycle = app.get(CombinedPipelineService);
    const result = await cycle.runCombinedOnce();
    const after = await db
      .collection(db.articlesCollectionName)
      .countDocuments();
    expect(result.stats).toBeDefined();
    expect(after).toBeGreaterThanOrEqual(before);
    expect(result.command).toBe('nestjs:combined-pipeline');
    // Evidence for the audit. No secrets.
    console.log(
      JSON.stringify({
        exit: result.exitCode,
        inserted: result.stats.inserted,
        duplicates: result.stats.duplicates,
        fetched: result.stats.articles_fetched,
        lokal: result.stats.lokal_processed,
        youtube: result.stats.youtube_processed,
        sakshi: result.stats.sakshi_processed,
        errors: result.stats.errors.slice(0, 8),
        articles_before: before,
        articles_after: after,
      }),
    );
  }, 180000);
});
