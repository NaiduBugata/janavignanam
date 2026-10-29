import { Injectable, Logger } from '@nestjs/common';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Document } from 'mongodb';
import { ArticleRepository } from '../database/repositories/article.repository';
import { DailyReportRepository } from '../database/repositories/daily-report.repository';
import { buildEmailHtml } from './report-html';
import { writeTextPdf } from './report-pdf';
import { generateExecutiveSummary } from './report-summary';
import {
  articlesForDay,
  computeStats,
  formatLongDate,
  previousReportDay,
  type ReportArticle,
  type ReportStats,
} from './report-stats';
import { notifyDailyWhatsApp } from '../whatsapp/whatsapp.notify';
import {
  parseRecipients,
  sendReportEmail,
  type EmailSendResult,
} from './report-email';

export interface ReportRunResult {
  status: string;
  report_date: string;
  reason?: string;
  error?: string | null;
  recipients?: string[];
  attempts?: number;
  articles_included?: number;
  problems_count?: number;
  positive_count?: number;
  negative_count?: number;
  pdf_path?: string;
  subject?: string;
  notifications?: { results: Array<Record<string, unknown>> };
}

export interface GenerateOptions {
  force?: boolean;
  recipients?: string[];
  articles?: ReportArticle[];
  sourceDocs?: Array<Record<string, unknown>>;
  fetchImpl?: typeof fetch;
  now?: Date;
}

@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);

  constructor(
    private readonly reports: DailyReportRepository,
    private readonly articles: ArticleRepository,
  ) {}

  async history(limit = 60): Promise<Document[]> {
    return this.reports.history(limit);
  }

  async getById(reportId: string): Promise<Document | null> {
    return this.reports.getById(reportId);
  }

  /** Build and record a report, email it with the PDF, and post the summary on WhatsApp when alerts are on there. */
  async generateAndSend(
    target: string | null,
    options: GenerateOptions = {},
  ): Promise<ReportRunResult> {
    const day = target || previousReportDay(options.now || new Date());
    if (!options.force && (await this.reports.alreadySent(day))) {
      this.logger.log(`Report for ${day} already sent; skipping.`);
      return { status: 'skipped', reason: 'already_sent', report_date: day };
    }
    try {
      const built = await this.build(day, options);
      const fetchImpl = options.fetchImpl || fetch;
      const recipients = options.recipients?.length
        ? options.recipients
        : parseRecipients(process.env.REPORT_RECIPIENTS || '').valid;
      await this.reports.recordGeneration(
        day,
        built.stats,
        recipients,
        built.pdfPath,
      );
      const email = await this.emailReport(
        built,
        options.recipients,
        fetchImpl,
      );
      const whatsapp = await notifyDailyWhatsApp(
        {
          total: built.stats.total,
          positive: built.stats.positive,
          negative: built.stats.negative,
          problems: built.stats.problems,
        },
        day,
        fetchImpl,
      );
      const notifications = {
        results: [{ ...email }, { channel: 'whatsapp', ...whatsapp }],
      };
      const delivered = [email, whatsapp].filter(
        (result) => result.success && !result.skipped,
      );
      if (delivered.length) {
        const attempts = delivered[0].attempts;
        await this.reports.recordSent(day, attempts);
        return this.outcome(
          'sent',
          day,
          built,
          recipients,
          attempts,
          null,
          notifications,
        );
      }
      const problem = (
        channel: string,
        result: {
          skipped: boolean;
          skip_reason?: string;
          error: string | null;
        },
      ) =>
        result.skipped
          ? `${channel}_skipped: ${result.skip_reason || 'unknown'}`
          : `${channel}_failed: ${result.error || 'unknown'}`;
      const error = `${problem('email', email)}; ${problem('whatsapp', whatsapp)}`;
      const attempts = Math.max(email.attempts, whatsapp.attempts);
      await this.reports.recordFailed(day, attempts, error);
      return this.outcome(
        'failed',
        day,
        built,
        recipients,
        attempts,
        error,
        notifications,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Report build failed for ${day}: ${message}`);
      await this.reports.recordFailed(day, 0, `build_failed: ${message}`);
      return {
        status: 'error',
        reason: 'build_failed',
        error: message,
        report_date: day,
      };
    }
  }

  private async emailReport(
    built: { html: string; pdfPath: string; subject: string },
    recipients: string[] | undefined,
    fetchImpl: typeof fetch,
  ): Promise<EmailSendResult> {
    try {
      return await sendReportEmail(
        built.subject,
        built.html,
        built.pdfPath,
        recipients,
        fetchImpl,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Report email failed: ${message}`);
      return {
        channel: 'email',
        success: false,
        skipped: false,
        error: message,
        attempts: 0,
      };
    }
  }

  private async build(
    day: string,
    options: GenerateOptions,
  ): Promise<{
    stats: ReportStats;
    html: string;
    pdfPath: string;
    subject: string;
  }> {
    const now = options.now || new Date();
    let articles = options.articles;
    if (!articles) {
      const docs = options.sourceDocs || (await this.articles.findAll());
      articles = articlesForDay(docs, day);
    }
    const stats = computeStats(articles);
    const summary = await generateExecutiveSummary(
      day,
      articles,
      stats,
      options.fetchImpl || fetch,
    );
    const html = buildEmailHtml(day, now, articles, stats, summary);
    const fileName = `Daily_Report_${day.replace(/-/g, '_')}.pdf`;
    const lines = [
      'MediaSphere Daily Constituency Report',
      formatLongDate(day),
      '',
      'Executive Summary',
      summary,
      '',
      `Articles: ${stats.total}`,
      `Problems: ${stats.problems}`,
      `Positive: ${stats.positive}`,
      `Negative: ${stats.negative}`,
    ];
    let pdfPath = resolve(
      process.cwd(),
      process.env.REPORT_OUTPUT_DIR || join(tmpdir(), 'mediasphere_reports'),
      fileName,
    );
    try {
      writeTextPdf(pdfPath, lines);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'EACCES' && code !== 'EPERM' && code !== 'EROFS') throw err;
      // Hosts such as Railway run as a user who cannot write under /app.
      this.logger.warn(
        `report folder not writable (${code}); using the temp folder`,
      );
      pdfPath = join(tmpdir(), 'mediasphere_reports', fileName);
      writeTextPdf(pdfPath, lines);
    }
    return {
      stats,
      html,
      pdfPath,
      subject: `MediaSphere Daily Constituency Report - ${formatLongDate(day)}`,
    };
  }

  private outcome(
    status: string,
    day: string,
    built: { stats: ReportStats; pdfPath: string; subject: string },
    recipients: string[],
    attempts: number,
    error: string | null,
    notifications: { results: Array<Record<string, unknown>> },
  ): ReportRunResult {
    return {
      status,
      report_date: day,
      recipients,
      attempts,
      error,
      articles_included: built.stats.total,
      problems_count: built.stats.problems,
      positive_count: built.stats.positive,
      negative_count: built.stats.negative,
      pdf_path: built.pdfPath,
      subject: built.subject,
      notifications,
    };
  }
}
