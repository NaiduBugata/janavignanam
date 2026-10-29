import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { analyzeNewsArticle } from '../../ai/groq-analyzer';
import { titlesMatch } from './fuzzy-title';
import type { BridgeResult, CycleStats } from '../python-bridge.service';
import { emptyStats } from '../python-bridge.service';
import type {
  CollectedArticle,
  SourceCollectionResult,
  SourceName,
} from '../../sources/source-collector';
import { collectLokalNews } from '../../sources/lokal/lokal.collector';
import { collectSakshiNews } from '../../sources/sakshi/sakshi.collector';
import { collectYoutubeNews } from '../../sources/youtube/youtube.collector';
import { mergeSourceResults } from '../combined-cycle';
import {
  notifyFailureWhatsApp,
  notifyPendingWhatsApp,
  notifyPipelineWhatsApp,
} from '../../whatsapp/whatsapp.notify';
import {
  describeFailure,
  FailureAlertGate,
  pipelineStatusWhatsAppEnabled,
} from './pipeline-alerts';
import {
  ASSEMBLY_SEGMENTS,
  scoreConstituency,
  type AssemblySegment,
} from './constituency';
import { isReligionStory } from './religion';
import { whatsappAlertsEnabled } from '../../whatsapp/whatsapp.send';
import { sendPipelineFailureEmail } from '../../notifications/failure-email';
import { sendNewArticlesEmail } from '../../notifications/news-email';

function httpUrl(value: unknown): string {
  if (typeof value !== 'string') return '';
  const url = value.trim();
  return url.startsWith('http://') || url.startsWith('https://') ? url : '';
}

/** First usable picture on a Lokal post (`images` is an object or a list). */
function lokalThumbnail(raw: Record<string, unknown> | undefined): string {
  if (!raw) return '';
  const images = raw.images;
  const list = Array.isArray(images) ? images : images ? [images] : [];
  for (const item of list) {
    if (!item || typeof item !== 'object') {
      const direct = httpUrl(item);
      if (direct) return direct;
      continue;
    }
    const row = item as Record<string, unknown>;
    const found =
      httpUrl(row.image) || httpUrl(row.thumb_url) || httpUrl(row.url);
    if (found) return found;
  }
  return httpUrl(raw.image) || httpUrl(raw.thumb_url);
}

export interface NativeCycleHooks {
  fetchImpl?: typeof fetch;
  now?: () => Date;
}

/** Items already judged (duplicate posts, rejected videos and pages), skipped for SEEN_DAYS so YouTube is not asked again every hour. */
const SEEN_COLLECTION = 'pipeline_seen';
const SEEN_DAYS = 7;

interface KnownItems {
  postIds: Set<string>;
  urls: Set<string>;
}

/**
 * Nest combined cycle: Lokal → YouTube → Sakshi → Groq stages → upsert → notify.
 * New articles and failures are emailed. Pipeline success and failure also go to the super admin on WhatsApp.
 * Sequential, matching Flask pipeline/runner.py. Notification errors never roll back writes.
 * PIPELINE_EXECUTOR=python keeps the Phase 3 bridge for tests.
 */
@Injectable()
export class CombinedPipelineService {
  private readonly logger = new Logger(CombinedPipelineService.name);
  private readonly failureAlerts = new FailureAlertGate();

  constructor(private readonly db: DatabaseService) {}

  async runCombinedOnce(hooks: NativeCycleHooks = {}): Promise<BridgeResult> {
    const started = Date.now();
    const fetchImpl = hooks.fetchImpl ?? fetch;
    const maxAnalyze = Number(process.env.PIPELINE_MAX_ANALYZE || '8');
    const errors: string[] = [];
    const results: SourceCollectionResult[] = [];
    const known = await this.loadKnown();
    const checked: string[] = [];

    results.push(
      await this.safeCollect('lokal', () => this.collectLokal(fetchImpl)),
    );
    results.push(
      await this.safeCollect('youtube', () =>
        this.collectYoutube(fetchImpl, known, checked),
      ),
    );
    results.push(
      await this.safeCollect('sakshi', () =>
        this.collectSakshi(fetchImpl, known, checked),
      ),
    );

    let alreadySaved = 0;
    const mapped: CollectedArticle[] = [];
    for (const article of results.flatMap((r) => r.articles)) {
      if (known.postIds.has(article.post_id)) {
        alreadySaved += 1;
        continue;
      }
      const segment = resolveSegment(article);
      if (!segment) {
        this.logger.warn(
          `[SEGMENT_GATE] dropped source=${article.source} post_id=${article.post_id}: not one of the 7 assembly segments`,
        );
        continue;
      }
      if (isReligionStory(article.title, article.content || '')) {
        checked.push(`post:${article.post_id}`);
        this.logger.log(
          `[RELIGION] skipped source=${article.source} post_id=${article.post_id}`,
        );
        continue;
      }
      mapped.push({ ...article, assembly_segment: segment });
    }
    const articles = mapped.slice(0, maxAnalyze);
    let inserted = 0;
    let duplicates = 0;
    let aiFailed = 0;
    let aiOk = 0;
    const added: Array<Record<string, unknown>> = [];

    for (const article of articles) {
      try {
        const analyzed = await this.analyze(article, fetchImpl);
        const outcome = await this.upsert(article, analyzed);
        if (outcome === 'inserted') {
          inserted += 1;
          added.push({
            ...analyzed,
            title: article.title,
            source: article.source,
            source_url: article.source_url || null,
          });
        } else {
          duplicates += 1;
          checked.push(`post:${article.post_id}`);
        }
        aiOk += 1;
      } catch (err) {
        aiFailed += 1;
        const message = err instanceof Error ? err.message : String(err);
        errors.push(
          `${article.source}:${article.post_id}:${message.slice(0, 180)}`,
        );
        this.logger.error(
          `[AI_FAIL] source=${article.source} post_id=${article.post_id} ${message}`,
        );
      }
    }

    await this.remember(checked);
    if (alreadySaved)
      this.logger.log(
        `[KNOWN] skipped ${alreadySaved} already-saved articles before analysis`,
      );

    const merged = mergeSourceResults(results);
    // One blocked source does not fail the cycle while another source delivered; its errors are still recorded and alerted.
    const delivered = results.some((r) => r.status === 'success');
    const exitCode = aiFailed ? 1 : delivered ? 0 : merged.exitCode;
    const stats: CycleStats = {
      ...emptyStats(),
      articles_fetched: merged.articles_fetched,
      duplicates: merged.duplicates + duplicates + alreadySaved,
      inserted,
      lokal_processed: merged.lokal_processed,
      youtube_processed: merged.youtube_processed,
      sakshi_processed: merged.sakshi_processed,
      errors: [...merged.errors, ...errors],
    };
    if (aiFailed) stats.errors.push(`ai_failed=${aiFailed}`);

    await this.notifyPipeline(
      stats,
      exitCode,
      fetchImpl,
      Date.now() - started,
      added,
    );

    this.logger.log(
      `[NATIVE_CYCLE] exit=${exitCode} inserted=${inserted} duplicates=${stats.duplicates} ai_ok=${aiOk} ai_failed=${aiFailed} ms=${Date.now() - started}`,
    );

    return {
      exitCode,
      stats,
      timedOut: false,
      parsed: true,
      outputTail: `ai_ok=${aiOk} ai_failed=${aiFailed}`,
      command: 'nestjs:combined-pipeline',
    };
  }

  /** Saved articles plus recently judged items. Never throws: on error every item is treated as new. */
  private async loadKnown(): Promise<KnownItems> {
    const known: KnownItems = { postIds: new Set(), urls: new Set() };
    try {
      await this.db.ensureConnected();
      const saved = await this.db.query<{
        post_id: string | null;
        source_url: string | null;
      }>(
        `SELECT doc->>'post_id' AS post_id, doc->>'source_url' AS source_url
           FROM mediasphere.documents WHERE collection = $1`,
        [this.db.articlesCollectionName],
      );
      const seen = await this.db.query<{ doc_id: string }>(
        `SELECT doc_id FROM mediasphere.documents
          WHERE collection = $1 AND exported_at > now() - make_interval(days => $2::int)`,
        [SEEN_COLLECTION, SEEN_DAYS],
      );
      for (const row of saved) {
        if (row.post_id) known.postIds.add(row.post_id);
        if (row.source_url) known.urls.add(row.source_url);
      }
      for (const { doc_id: key } of seen) {
        if (key.startsWith('post:')) known.postIds.add(key.slice(5));
        else if (key.startsWith('url:')) known.urls.add(key.slice(4));
      }
    } catch (err) {
      this.logger.warn(
        `[KNOWN] saved items unavailable, treating all as new: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    return known;
  }

  private async remember(keys: string[]): Promise<void> {
    const unique = [...new Set(keys)];
    if (!unique.length) return;
    try {
      await this.db.query(
        `INSERT INTO mediasphere.documents (collection, doc_id, doc)
         SELECT $1, k, jsonb_build_object('seen_at', $3::text) FROM unnest($2::text[]) AS k
         ON CONFLICT (collection, doc_id) DO UPDATE SET doc = EXCLUDED.doc, exported_at = now()`,
        [SEEN_COLLECTION, unique, new Date().toISOString()],
      );
      await this.db.query(
        `DELETE FROM mediasphere.documents
          WHERE collection = $1 AND exported_at < now() - make_interval(days => $2::int)`,
        [SEEN_COLLECTION, SEEN_DAYS * 4],
      );
    } catch (err) {
      this.logger.warn(
        `[KNOWN] could not remember checked items: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private async safeCollect(
    source: SourceName,
    fn: () => Promise<SourceCollectionResult>,
  ): Promise<SourceCollectionResult> {
    const startedAt = new Date().toISOString();
    try {
      return await fn();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return this.emptyResult(source, startedAt, [
        `${source}_failed:${message.slice(0, 180)}`,
      ]);
    }
  }

  private async collectLokal(
    fetchImpl: typeof fetch,
  ): Promise<SourceCollectionResult> {
    const started = Date.now();
    const startedAt = new Date().toISOString();
    const collected = await collectLokalNews(fetchImpl);
    const articles: CollectedArticle[] = collected.envelope.articles.map(
      (article) => ({
        post_id: String(article.id),
        source: 'lokal',
        title: article.title,
        content: article.content,
        created_on: article.created_on,
        source_url: article.url,
        thumbnail: lokalThumbnail(article.raw),
        assembly_segment: article._constituency_validation?.segment ?? null,
      }),
    );
    return {
      source: 'lokal',
      status: 'success',
      startedAt,
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - started,
      itemsFound: articles.length,
      itemsNew: articles.length,
      itemsDuplicate: collected.duplicatesRemoved,
      itemsFailed: collected.constituencyRejected,
      errors: [],
      articles,
      exitCode: 0,
    };
  }

  private async collectYoutube(
    fetchImpl: typeof fetch,
    known: KnownItems,
    checked: string[],
  ): Promise<SourceCollectionResult> {
    const startedAt = new Date().toISOString();
    const started = Date.now();
    if (process.env.YOUTUBE_ENABLED === 'false') {
      return {
        ...this.emptyResult('youtube', startedAt, []),
        status: 'skipped',
        exitCode: 0,
      };
    }
    const existingVideoIds = new Set(
      [...known.postIds]
        .filter((id) => id.startsWith('yt_'))
        .map((id) => id.slice(3)),
    );
    const collected = await collectYoutubeNews({ fetchImpl, existingVideoIds });
    checked.push(
      ...(collected.checkedVideoIds || []).map((id) => `post:yt_${id}`),
    );
    if (collected.error) {
      return this.emptyResult('youtube', startedAt, [collected.error]);
    }
    const blockedReasons =
      Object.entries(collected.blocked)
        .map(([reason, count]) => `${reason}=${count}`)
        .join(',') || 'none';
    this.logger.log(
      `[YOUTUBE] videos=${collected.videosFound} articles=${collected.envelope.articles.length} no_captions=${collected.noCaptions} blocked=${blockedReasons} non_news=${collected.nonNews} other_constituency=${collected.constituencyRejected}`,
    );
    const articles: CollectedArticle[] = collected.envelope.articles.map(
      (article) => ({
        post_id: `yt_${article.video_id}`,
        source: 'youtube',
        title: article.title,
        content: article.content,
        created_on: article.created_on,
        source_url: article.url,
        thumbnail: article.video_id
          ? `https://i.ytimg.com/vi/${article.video_id}/hqdefault.jpg`
          : '',
        assembly_segment: article.assembly_segment ?? null,
      }),
    );
    if (!articles.length && collected.errors.length) {
      return this.emptyResult(
        'youtube',
        startedAt,
        collected.errors.slice(0, 8),
      );
    }
    return {
      source: 'youtube',
      status: 'success',
      startedAt,
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - started,
      itemsFound: articles.length,
      itemsNew: articles.length,
      itemsDuplicate: 0,
      itemsFailed: 0,
      errors: [],
      articles,
      exitCode: 0,
    };
  }

  private async collectSakshi(
    fetchImpl: typeof fetch,
    known: KnownItems,
    checked: string[],
  ): Promise<SourceCollectionResult> {
    const startedAt = new Date().toISOString();
    const started = Date.now();
    if (process.env.SAKSHI_ENABLED === 'false') {
      return {
        ...this.emptyResult('sakshi', startedAt, []),
        status: 'skipped',
        exitCode: 0,
      };
    }
    const collected = await collectSakshiNews({
      fetchImpl,
      existingUrls: known.urls,
    });
    checked.push(...(collected.checkedUrls || []).map((url) => `url:${url}`));
    if (collected.error) {
      return this.emptyResult('sakshi', startedAt, [collected.error]);
    }
    const articles: CollectedArticle[] = collected.envelope.articles.map(
      (article) => ({
        post_id: article.id.startsWith('sakshi_')
          ? article.id
          : `sakshi_${article.id}`,
        source: 'sakshi',
        title: article.title,
        content: article.content,
        created_on: article.created_on,
        source_url: article.source_url,
        thumbnail: article.thumbnail || '',
        assembly_segment: article.assembly_segment,
      }),
    );
    this.logger.log(
      `[SAKSHI] links=${collected.linksFound} already_saved=${collected.skippedExisting} new=${articles.length} rejected=${collected.envelope.filter_stats.rejected}`,
    );
    if (!collected.linksFound)
      return this.emptyResult('sakshi', startedAt, ['sakshi_no_links']);
    return {
      source: 'sakshi',
      status: 'success',
      startedAt,
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - started,
      itemsFound: articles.length,
      itemsNew: articles.length,
      itemsDuplicate: collected.skippedExisting,
      itemsFailed: collected.envelope.filter_stats.rejected,
      errors: [],
      articles,
      exitCode: 0,
    };
  }

  /** Python Groq analyzer: three stages, normalize, validate, quality, problem id. */
  async analyze(
    article: CollectedArticle,
    fetchImpl: typeof fetch = fetch,
  ): Promise<Record<string, unknown>> {
    return analyzeNewsArticle(
      {
        articleId: article.post_id,
        title: article.title,
        content: article.content || '',
      },
      fetchImpl,
    );
  }

  private async upsert(
    article: CollectedArticle,
    analyzed: Record<string, unknown>,
  ): Promise<'inserted' | 'duplicate'> {
    await this.db.ensureConnected();
    const coll = this.db.collection(this.db.articlesCollectionName);
    const now = new Date().toISOString();
    const fingerprint = createHash('sha256')
      .update(
        `${(article.title || '').trim()}|${(article.content || '').trim()}|${article.created_on || ''}|${article.source}`,
        'utf8',
      )
      .digest('hex');
    const doc = {
      post_id: article.post_id,
      source: article.source,
      title: article.title,
      summary: analyzed.summary,
      sentiment: analyzed.sentiment,
      category: analyzed.category,
      subcategory: analyzed.subcategory,
      problem: analyzed.problem,
      problem_id: analyzed.problem_id,
      severity: analyzed.severity,
      authority: analyzed.authority,
      location: analyzed.location,
      entities: analyzed.entities,
      keywords: analyzed.keywords,
      source_url: article.source_url || null,
      created_on: article.created_on || null,
      constituency: 'Narasaraopet',
      assembly_segment: article.assembly_segment,
      ...(article.thumbnail ? { thumbnail: article.thumbnail } : {}),
      content_fingerprint: fingerprint,
      last_updated_at: now,
    };
    let prior: Array<{ title?: string; post_id?: string }> = [];
    try {
      prior = await coll.find({ source: article.source }).limit(15).toArray();
    } catch {
      prior = [];
    }
    for (const row of prior) {
      if (
        row.post_id !== article.post_id &&
        titlesMatch(article.title, String(row.title || ''))
      ) {
        return 'duplicate';
      }
    }
    try {
      const result = await coll.updateOne(
        { post_id: article.post_id },
        {
          $set: doc,
          $setOnInsert: {
            first_seen_at: now,
            whatsapp_sent: false,
          },
        },
        { upsert: true },
      );
      return result.upsertedCount > 0 ? 'inserted' : 'duplicate';
    } catch (err) {
      const code = (err as { code?: number }).code;
      if (code === 11000) return 'duplicate';
      throw err;
    }
  }

  private async notifyPipeline(
    stats: CycleStats,
    exitCode: number,
    fetchImpl: typeof fetch,
    durationMs: number,
    added: Array<Record<string, unknown>> = [],
  ): Promise<void> {
    this.logger.log(
      `[NOTIFY_PIPELINE] exit=${exitCode} inserted=${stats.inserted} errors=${stats.errors.length}`,
    );
    if (stats.errors.length) await this.alertFailure(stats.errors, fetchImpl);
    else {
      this.failureAlerts.clear();
      if (pipelineStatusWhatsAppEnabled()) {
        try {
          await notifyPipelineWhatsApp(
            {
              ...stats,
              duration_seconds: Math.round(durationMs / 1000),
              status: 'Finished Successfully',
            },
            fetchImpl,
          );
        } catch (err) {
          this.logger.error(
            `[NOTIFY_PIPELINE] WhatsApp failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    }
    await this.emailNewArticles(added, fetchImpl);
    try {
      if (!whatsappAlertsEnabled()) return;
      await notifyPendingWhatsApp({
        fetchImpl,
        findPending: async () => {
          await this.db.ensureConnected();
          const rows = await this.db
            .collection(this.db.articlesCollectionName)
            .find({ whatsapp_sent: false })
            .limit(5)
            .toArray();
          return rows;
        },
        markSent: async (postId, messageId, critical) => {
          const now = new Date().toISOString();
          const update: Record<string, unknown> = {
            whatsapp_sent: true,
            whatsapp_sent_at: now,
            whatsapp_message_id: messageId,
          };
          if (critical) {
            update.whatsapp_critical_sent = true;
            update.whatsapp_critical_sent_at = now;
          }
          await this.db
            .collection(this.db.articlesCollectionName)
            .updateOne({ post_id: postId }, { $set: update });
        },
      });
    } catch (err) {
      this.logger.error(
        'notification failed (ignored): ' +
          (err instanceof Error ? err.message : String(err)),
      );
    }
  }

  private async emailNewArticles(
    added: Array<Record<string, unknown>>,
    fetchImpl: typeof fetch,
  ): Promise<void> {
    if (!added.length) return;
    try {
      const email = await sendNewArticlesEmail({ articles: added, fetchImpl });
      if (email.success && !email.skipped)
        this.logger.log(`[NOTIFY_NEWS_EMAIL] sent articles=${added.length}`);
      else if (email.skipped)
        this.logger.log(`[NOTIFY_NEWS_EMAIL] skipped: ${email.skip_reason}`);
      else
        this.logger.error(
          `[NOTIFY_NEWS_EMAIL] failed: ${String(email.error).slice(0, 300)}`,
        );
    } catch (err) {
      this.logger.error(
        `[NOTIFY_NEWS_EMAIL] failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Failure alert by email, and on WhatsApp to the super admin. A new problem alerts at once;
   * the same problem repeats only after PIPELINE_ALERT_REPEAT_HOURS. Never throws.
   */
  async alertFailure(
    errors: readonly string[],
    fetchImpl: typeof fetch = fetch,
  ): Promise<void> {
    const reason = describeFailure(errors).slice(0, 500);
    if (!this.failureAlerts.shouldAlert(errors, Date.now())) {
      this.logger.warn(
        `[NOTIFY_FAILURE] same problem as the last alert; email skipped: ${reason}`,
      );
      return;
    }
    try {
      await notifyFailureWhatsApp(
        'combined_pipeline',
        reason,
        'N/A',
        fetchImpl,
      );
    } catch (err) {
      this.logger.error(
        `[NOTIFY_FAILURE] WhatsApp failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    try {
      const email = await sendPipelineFailureEmail({
        reason,
        errors,
        fetchImpl,
      });
      if (email.success) this.logger.log('[NOTIFY_FAILURE_EMAIL] sent');
      else if (email.skipped)
        this.logger.log(`[NOTIFY_FAILURE_EMAIL] skipped: ${email.skip_reason}`);
      else
        this.logger.error(
          `[NOTIFY_FAILURE_EMAIL] failed: ${String(email.error).slice(0, 300)}`,
        );
    } catch (err) {
      this.logger.error(
        `[NOTIFY_FAILURE_EMAIL] failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private emptyResult(
    source: SourceName,
    startedAt: string,
    errors: string[],
  ): SourceCollectionResult {
    return {
      source,
      status: errors.length ? 'failed' : 'success',
      startedAt,
      completedAt: new Date().toISOString(),
      durationMs: 0,
      itemsFound: 0,
      itemsNew: 0,
      itemsDuplicate: 0,
      itemsFailed: errors.length ? 1 : 0,
      errors,
      articles: [],
      exitCode: errors.length ? 1 : 0,
    };
  }
}

/** Port of DecisionEngine.decide. */
export function decide(
  results: Array<Record<string, unknown>>,
  retriesRemaining: number,
): 'accept' | 'retry' | 'reject' {
  if (results.some((r) => r.severity === 'CRITICAL')) return 'reject';
  const unrepaired = results.some((r) => r.severity === 'ERROR' && !r.repaired);
  if (unrepaired) return retriesRemaining > 0 ? 'retry' : 'reject';
  return 'accept';
}

/** The segment a collector assigned, or a fresh full check. Anything else is outside the constituency. */
export function resolveSegment(
  article: CollectedArticle,
): AssemblySegment | null {
  const assigned = article.assembly_segment;
  if (assigned && (ASSEMBLY_SEGMENTS as readonly string[]).includes(assigned))
    return assigned as AssemblySegment;
  const checked = scoreConstituency(
    `${article.title || ''}\n${article.content || ''}`,
  );
  return checked.valid ? checked.segment : null;
}

function dedupeById(articles: CollectedArticle[]): CollectedArticle[] {
  const map = new Map<string, CollectedArticle>();
  for (const article of articles) map.set(article.post_id, article);
  return [...map.values()];
}
