import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { Document } from 'mongodb';
import { ArticleRepository } from '../database/repositories/article.repository';
import { PipelineStateRepository } from '../database/repositories/pipeline-state.repository';
import { hasAssemblySegment } from '../pipeline/native/constituency';
import {
  NormalizedArticle,
  NewsListResponse,
  NewsStatsResponse,
} from '../common/types/article';
import {
  entityDisplayName,
  falsyToDefault,
  falsyToEmptyString,
  flaskDateKey,
  parseFlaskDate,
  utcDaysBackIso,
} from '../common/utils/dates';
import {
  ReportFilterOptions,
  ReportStatsSummary,
  generatePdfReport,
  generateExcelReport,
  generateCsvReport,
} from './news-report';

export function isGrievanceOrProblem(article: NormalizedArticle): boolean {
  if (
    article.sentiment === 'Problem' ||
    article.problem ||
    article.problem_id
  ) {
    return true;
  }
  if (article.sentiment === 'Negative') {
    const civicCategories = new Set([
      'Crime',
      'Roads',
      'Transport',
      'Water',
      'Health',
      'Infrastructure',
      'Social Welfare',
      'Employment',
      'Agriculture',
      'Education',
      'Environment',
      'Civic',
    ]);
    if (civicCategories.has(article.category)) return true;
    const txt = `${article.title} ${article.summary}`.toLowerCase();
    if (
      /సమస్య|ఫిర్యాదు|ఇబ్బంది|మరమ్మతు|మురుగు|వరద|కొరత|రోడ్డు|problem|issue|grievance|complaint|repair|drainage|damage/iu.test(
        txt,
      )
    ) {
      return true;
    }
  }
  return false;
}

@Injectable()
export class NewsService implements OnModuleInit {
  private readonly logger = new Logger(NewsService.name);

  constructor(
    private readonly articles: ArticleRepository,
    private readonly pipelineState: PipelineStateRepository,
  ) {}

  async onModuleInit(): Promise<void> {
    // Warm in-memory cache in background on startup so first client request responds instantaneously
    this.constituencyDocs().catch(() => undefined);
  }

  normalizeArticle(doc: Document): NormalizedArticle {
    const locationRaw = doc.location;
    const location =
      locationRaw &&
      typeof locationRaw === 'object' &&
      !Array.isArray(locationRaw)
        ? (locationRaw as Record<string, unknown>)
        : {};

    const keywordsRaw = doc.keywords;
    const entitiesRaw = doc.entities;
    const tagsRaw = doc.tags;

    return {
      _id: String(doc._id ?? ''),
      post_id: doc.post_id,
      title: falsyToEmptyString(doc.title),
      summary: falsyToEmptyString(doc.summary),
      category: falsyToEmptyString(doc.category),
      subcategory: falsyToEmptyString(doc.subcategory),
      sentiment: falsyToEmptyString(doc.sentiment),
      location: {
        district: (location.district as string) ?? null,
        mandal: (location.mandal as string) ?? null,
        village: (location.village as string) ?? null,
        town: (location.town as string) ?? null,
        state: falsyToDefault(location.state, 'Andhra Pradesh'),
      },
      keywords: keywordsRaw ? (keywordsRaw as unknown[]) : [],
      entities: entitiesRaw ? (entitiesRaw as unknown[]) : [],
      problem: doc.problem ?? null,
      problem_id: doc.problem_id ?? null,
      source_url: falsyToEmptyString(doc.source_url),
      // Flask: doc.get("source") or "lokal"  — empty string becomes lokal
      source: falsyToDefault(doc.source, 'lokal'),
      channel: falsyToEmptyString(doc.channel),
      thumbnail: falsyToEmptyString(
        doc.thumbnail || doc.thumbnail_url || doc.image_url || '',
      ),
      author: falsyToEmptyString(doc.author),
      tags: tagsRaw ? (tagsRaw as unknown[]) : [],
      created_on: falsyToEmptyString(doc.created_on),
      first_seen_at: falsyToEmptyString(doc.first_seen_at),
      last_updated_at: falsyToEmptyString(doc.last_updated_at),
      assembly_segment: falsyToEmptyString(doc.assembly_segment),
    };
  }

  private cachedDocs: { docs: Document[]; expiresAt: number } | null = null;
  private pendingDocsFetch: Promise<Document[]> | null = null;

  clearCache(): void {
    this.cachedDocs = null;
    this.pendingDocsFetch = null;
  }

  private async fetchFreshDocs(): Promise<Document[]> {
    try {
      const docs = (await this.articles.findAll()).filter((doc) =>
        hasAssemblySegment(doc),
      );
      // Cache for 10 minutes in memory. Pipeline calls clearCache() whenever new articles are ingested.
      this.cachedDocs = { docs, expiresAt: Date.now() + 10 * 60_000 };
      return docs;
    } catch (err) {
      this.logger.warn(
        'Failed to fetch fresh articles from database: ' +
          (err instanceof Error ? err.message : String(err)),
      );
      if (this.cachedDocs && this.cachedDocs.docs.length > 0) {
        return this.cachedDocs.docs;
      }
      return [];
    }
  }

  /** Only articles mapped to one of the seven assembly segments belong to the constituency dataset. */
  private async constituencyDocs(forceFresh = false): Promise<Document[]> {
    const now = Date.now();
    if (!forceFresh && this.cachedDocs && this.cachedDocs.expiresAt > now) {
      return this.cachedDocs.docs;
    }
    // Stale-while-revalidate: if we have cached data, return immediately and refresh in background
    if (!forceFresh && this.cachedDocs && this.cachedDocs.docs.length > 0) {
      if (!this.pendingDocsFetch) {
        this.pendingDocsFetch = this.fetchFreshDocs()
          .catch((err) => {
            this.logger.warn(
              'Background article refresh failed: ' +
                (err instanceof Error ? err.message : String(err)),
            );
            return this.cachedDocs?.docs || [];
          })
          .finally(() => {
            this.pendingDocsFetch = null;
          });
      }
      return this.cachedDocs.docs;
    }
    if (!forceFresh && this.pendingDocsFetch) {
      return this.pendingDocsFetch;
    }
    this.pendingDocsFetch = this.fetchFreshDocs()
      .catch((err) => {
        this.logger.warn(
          'Initial article fetch failed: ' +
            (err instanceof Error ? err.message : String(err)),
        );
        return this.cachedDocs?.docs || [];
      })
      .finally(() => {
        this.pendingDocsFetch = null;
      });
    return this.pendingDocsFetch;
  }

  private articleSortTimestamp(article: NormalizedArticle): number {
    for (const field of [
      'created_on',
      'first_seen_at',
      'last_updated_at',
    ] as const) {
      const parsed = parseFlaskDate(article[field] || '');
      if (parsed) return parsed.getTime() / 1000;
    }
    return 0;
  }

  private sortNewestFirst(articles: NormalizedArticle[]): NormalizedArticle[] {
    return [...articles].sort(
      (a, b) => this.articleSortTimestamp(b) - this.articleSortTimestamp(a),
    );
  }

  filterArticles(
    articles: NormalizedArticle[],
    filters: ReportFilterOptions = {},
  ): NormalizedArticle[] {
    let result = articles;

    if (filters.source && filters.source !== 'all') {
      const src = filters.source.toLowerCase();
      result = result.filter(
        (a) => (a.source || 'lokal').toLowerCase() === src,
      );
    }

    if (filters.sentiment && filters.sentiment !== 'all') {
      const sent = filters.sentiment.toLowerCase();
      if (sent === 'positive') {
        result = result.filter((a) => a.sentiment === 'Positive');
      } else if (sent === 'negative') {
        result = result.filter((a) => a.sentiment === 'Negative');
      } else if (
        sent === 'neutral' ||
        sent === 'statement' ||
        sent === 'statements'
      ) {
        result = result.filter(
          (a) => a.sentiment === 'Statement' || a.sentiment === 'Neutral',
        );
      } else if (sent === 'problem' || sent === 'problems') {
        result = result.filter((a) => isGrievanceOrProblem(a));
      }
    }

    if (filters.segment && filters.segment !== 'all') {
      const seg = filters.segment.toLowerCase();
      result = result.filter(
        (a) => (a.assembly_segment || '').toLowerCase() === seg,
      );
    }

    if (filters.division && filters.division !== 'all') {
      const div = filters.division.toLowerCase();
      const divMandals: Record<string, string[]> = {
        narasaraopet: [
          'chilakaluripet',
          'edlapadu',
          'nadendla',
          'narasaraopet',
          'rompicherla',
          'vinukonda',
          'bollapalli',
          'nuzendla',
          'savalyapuram',
          'ipur',
          'ipuru',
        ],
        sattenapalli: [
          'sattenapalle',
          'sattenapalli',
          'nekarikallu',
          'nakarikallu',
          'rajupalem',
          'muppalla',
          'pedakurapadu',
          'krosuru',
          'krosur',
          'bellamkonda',
          'atchampet',
          'achampet',
          'amaravathi',
          'amaravati',
        ],
        gurazala: [
          'gurazala',
          'gurajala',
          'dachepalli',
          'dachepalle',
          'piduguralla',
          'machavaram',
          'macherla',
          'durgi',
          'rentachintala',
          'karempudi',
          'veldurthi',
        ],
      };
      const allowed = divMandals[div] || [];
      if (allowed.length) {
        result = result.filter((a) => {
          const mandal = (a.location?.mandal || '').toLowerCase();
          const seg = (a.assembly_segment || '').toLowerCase();
          return allowed.some((m) => mandal.includes(m) || seg.includes(m));
        });
      }
    }

    if (filters.category && filters.category !== 'all') {
      const cat = filters.category.toLowerCase();
      result = result.filter((a) => (a.category || '').toLowerCase() === cat);
    }

    if (filters.startDate) {
      const start = filters.startDate.slice(0, 10);
      result = result.filter((a) => {
        const d =
          flaskDateKey(a.created_on || '') ||
          flaskDateKey(a.first_seen_at || '') ||
          (a.created_on || a.first_seen_at || '').slice(0, 10);
        return d && d >= start;
      });
    }

    if (filters.endDate) {
      const end = filters.endDate.slice(0, 10);
      result = result.filter((a) => {
        const d =
          flaskDateKey(a.created_on || '') ||
          flaskDateKey(a.first_seen_at || '') ||
          (a.created_on || a.first_seen_at || '').slice(0, 10);
        return d && d <= end;
      });
    }

    if (filters.search) {
      const q = filters.search.trim().toLowerCase();
      if (q) {
        result = result.filter(
          (a) =>
            (a.title || '').toLowerCase().includes(q) ||
            (a.summary || '').toLowerCase().includes(q) ||
            (a.assembly_segment || '').toLowerCase().includes(q),
        );
      }
    }

    return result;
  }

  async listNews(
    sourceOrFilters: string | ReportFilterOptions = 'all',
  ): Promise<NewsListResponse> {
    const docs = await this.constituencyDocs();
    let articles = this.sortNewestFirst(
      docs.map((d) => this.normalizeArticle(d)),
    );

    if (typeof sourceOrFilters === 'string') {
      articles = this.filterArticles(articles, { source: sourceOrFilters });
    } else if (sourceOrFilters && typeof sourceOrFilters === 'object') {
      articles = this.filterArticles(articles, sourceOrFilters);
    }

    let data_revision: string | null = null;
    try {
      data_revision = await this.pipelineState.getDataRevision();
    } catch {
      data_revision = null;
    }

    return { articles, count: articles.length, data_revision };
  }

  computeStats(articles: NormalizedArticle[]): Omit<
    NewsStatsResponse,
    'generated_at' | 'data_revision'
  > & {
    by_segment: Record<string, number>;
  } {
    const countMap = (items: string[]) => {
      const m: Record<string, number> = {};
      for (const i of items) m[i] = (m[i] || 0) + 1;
      return m;
    };

    const sentiment = countMap(articles.map((a) => a.sentiment || 'Unknown'));
    const category = countMap(articles.map((a) => a.category || 'Other'));
    const district = countMap(
      articles.map((a) => a.location.district || 'Unknown'),
    );
    const mandal = countMap(
      articles.map((a) => a.location.mandal || 'Unknown'),
    );
    const village = countMap(
      articles.map((a) => a.location.village || 'Unknown'),
    );
    const by_source = countMap(articles.map((a) => a.source || 'lokal'));
    const by_segment = countMap(
      articles.map((a) => a.assembly_segment || 'Narasaraopet'),
    );

    const keywordCounter: Record<string, number> = {};
    const entityCounter: Record<string, number> = {};
    for (const article of articles) {
      for (const kw of article.keywords || []) {
        if (kw) {
          const key = String(kw);
          keywordCounter[key] = (keywordCounter[key] || 0) + 1;
        }
      }
      for (const entity of article.entities || []) {
        const name = entityDisplayName(entity);
        if (name) entityCounter[name] = (entityCounter[name] || 0) + 1;
      }
    }

    const topN = (counter: Record<string, number>, n: number) =>
      Object.entries(counter)
        .sort((a, b) => b[1] - a[1])
        .slice(0, n)
        .map(([name, count]) => ({ name, count }));

    // Flask: today = datetime.now(timezone.utc).date() — UTC window
    const daily_counts: Record<string, number> = {};
    for (let i = 0; i < 7; i++) {
      daily_counts[utcDaysBackIso(i)] = 0;
    }

    for (const article of articles) {
      // Flask _date_key uses offset-aware calendar date (not UTC day)
      const key =
        flaskDateKey(article.first_seen_at || '') ||
        flaskDateKey(article.created_on || '');
      if (key && key in daily_counts) daily_counts[key] += 1;
    }

    const daily_trend = Object.keys(daily_counts)
      .sort()
      .map((date) => ({ date, count: daily_counts[date] }));

    const problem_count = articles.filter(isGrievanceOrProblem).length;

    return {
      total: articles.length,
      by_source,
      sentiment,
      category,
      district,
      mandal,
      village,
      daily_trend,
      top_keywords: topN(keywordCounter, 20),
      top_entities: topN(entityCounter, 20),
      positive_count: sentiment.Positive || 0,
      negative_count: sentiment.Negative || 0,
      neutral_count: (sentiment.Neutral || 0) + (sentiment.Statement || 0),
      statement_count: sentiment.Statement || 0,
      problem_count,
      by_segment,
    };
  }

  async getStats(
    filters: ReportFilterOptions = {},
  ): Promise<NewsStatsResponse & { by_segment: Record<string, number> }> {
    const docs = await this.constituencyDocs();
    let articles = docs.map((d) => this.normalizeArticle(d));
    if (Object.keys(filters).length) {
      articles = this.filterArticles(articles, filters);
    }
    const stats = this.computeStats(articles);
    let data_revision: string | null = null;
    try {
      data_revision = await this.pipelineState.getDataRevision();
    } catch {
      data_revision = null;
    }
    return {
      ...stats,
      generated_at: new Date().toISOString(),
      data_revision,
    };
  }

  async exportReport(
    filters: ReportFilterOptions,
    format: 'pdf' | 'xlsx' | 'csv',
  ): Promise<{ name: string; type: string; bytes: Buffer }> {
    const docs = await this.constituencyDocs();
    const allArticles = this.sortNewestFirst(
      docs.map((d) => this.normalizeArticle(d)),
    );
    const filtered = this.filterArticles(allArticles, filters);
    const stats = this.computeStats(filtered);

    const summary: ReportStatsSummary = {
      total: stats.total,
      positive: stats.positive_count,
      negative: stats.negative_count,
      neutral:
        stats.statement_count + (stats.neutral_count - stats.statement_count),
      problems: stats.problem_count,
      bySource: stats.by_source,
      bySegment: stats.by_segment,
      byCategory: stats.category,
    };

    const todayStr = new Date().toISOString().slice(0, 10);
    let baseName: string;

    if (filters.periodType === 'daily' && filters.startDate) {
      baseName = `Analytics_Daily_${filters.startDate}`;
    } else if (
      filters.periodType === 'weekly' &&
      filters.startDate &&
      filters.endDate
    ) {
      baseName = `Analytics_Weekly_${filters.startDate}_to_${filters.endDate}`;
    } else if (filters.periodType === 'monthly' && filters.startDate) {
      baseName = `Analytics_Monthly_${filters.startDate.slice(0, 7)}`;
    } else if (
      filters.periodType === 'custom' &&
      filters.startDate &&
      filters.endDate
    ) {
      baseName = `Analytics_Custom_${filters.startDate}_to_${filters.endDate}`;
    } else if (filters.periodType === 'all') {
      baseName = `Analytics_All_Records_${todayStr}`;
    } else {
      if (filters.startDate && filters.endDate) {
        baseName =
          filters.startDate === filters.endDate
            ? `Analytics_Daily_${filters.startDate}`
            : `Analytics_Custom_${filters.startDate}_to_${filters.endDate}`;
      } else {
        baseName = `Analytics_All_Records_${todayStr}`;
      }
    }

    if (format === 'xlsx') {
      const bytes = await generateExcelReport(filtered, filters, summary);
      return {
        name: `${baseName}.xlsx`,
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        bytes,
      };
    }

    if (format === 'csv') {
      const csv = generateCsvReport(filtered);
      return {
        name: `${baseName}.csv`,
        type: 'text/csv; charset=utf-8',
        bytes: Buffer.from(csv, 'utf-8'),
      };
    }

    const pdfBuffer = generatePdfReport(filtered, filters, summary);
    return {
      name: `${baseName}.pdf`,
      type: 'application/pdf',
      bytes: pdfBuffer,
    };
  }
}
