import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { ReportsSchedulerService } from './reports-scheduler.service';
import { ReportsService } from './reports.service';
import {
  articlesForDay,
  computeStats,
  enrichArticle,
  normalizeArticle,
} from './report-stats';
import type { ArticleRepository } from '../database/repositories/article.repository';
import type { DailyReportRepository } from '../database/repositories/daily-report.repository';

describe('daily reports', () => {
  const original = { ...process.env };
  let outputDir = '';

  beforeEach(() => {
    outputDir = mkdtempSync(join(tmpdir(), 'ms-report-'));
    process.env.EMAIL_ENABLED = 'false';
    process.env.WHATSAPP_ENABLED = 'false';
    process.env.REPORT_OUTPUT_DIR = outputDir;
    process.env.REPORT_SCHEDULER_ON_API = 'false';
    process.env.REPORT_CATCHUP_ON_START = 'false';
    delete process.env.GROQ_API_KEY;
    delete process.env.GROQ_API_KEYS;
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('GROQ_API_KEY')) delete process.env[key];
    }
  });

  afterEach(() => {
    process.env = { ...original };
    rmSync(outputDir, { recursive: true, force: true });
  });

  it('counts a roads problem as high priority for the target day', () => {
    const articles = articlesForDay(
      [
        {
          _id: '1',
          title: 'Road damage',
          summary: 'Potholes',
          category: 'Roads',
          sentiment: 'Problem',
          location: {
            district: 'Palnadu',
            mandal: 'Narasaraopet',
            village: 'Perecherla',
          },
          created_on: '2026-09-25T08:00:00+05:30',
          keywords: ['road'],
        },
        {
          _id: '2',
          title: 'Other day',
          category: 'Health',
          sentiment: 'Negative',
          created_on: '2026-09-24T08:00:00+05:30',
        },
      ],
      '2026-09-25',
    );
    const stats = computeStats(articles);
    expect(articles).toHaveLength(1);
    expect(stats.problems).toBe(1);
    expect(stats.high_priority_problems).toBe(1);
    expect(stats.action_items[0].department).toBe('Roads & Transport (R&B)');
    expect(stats.most_affected_village).toBe('Perecherla');
  });

  it('skips a day already sent and does not read articles', async () => {
    let read = false;
    const repo = {
      alreadySent: async () => true,
      recordGeneration: async () => null,
      recordFailed: async () => null,
      recordSent: async () => null,
    };
    const articles = {
      findAll: async () => {
        read = true;
        return [];
      },
    };
    const service = new ReportsService(
      repo as unknown as DailyReportRepository,
      articles as unknown as ArticleRepository,
    );
    const result = await service.generateAndSend('2026-09-25');
    expect(result).toEqual({
      status: 'skipped',
      reason: 'already_sent',
      report_date: '2026-09-25',
    });
    expect(read).toBe(false);
  });

  it('emails the daily report with its PDF and posts nothing on WhatsApp while WhatsApp alerts are off', async () => {
    process.env.EMAIL_ENABLED = 'true';
    process.env.EMAIL_PROVIDER = 'resend';
    process.env.RESEND_API_KEY = 'test';
    process.env.SMTP_FROM_EMAIL = 'from@example.com';
    process.env.REPORT_RECIPIENTS = 'desk@example.com';
    process.env.WHATSAPP_ENABLED = 'true';
    process.env.WHATSAPP_ACCESS_TOKEN = 'test-token';
    process.env.WHATSAPP_PHONE_NUMBER_ID = '987654321';
    process.env.WHATSAPP_RECIPIENTS = '919876543210';
    delete process.env.WHATSAPP_ALERTS_ENABLED;
    const sent: number[] = [];
    const repo = {
      alreadySent: async () => false,
      recordGeneration: async () => null,
      recordFailed: async () => {
        throw new Error('should not fail');
      },
      recordSent: async (_day: string, attempts: number) => {
        sent.push(attempts);
        return null;
      },
    };
    const service = new ReportsService(
      repo as unknown as DailyReportRepository,
      { findAll: async () => [] } as unknown as ArticleRepository,
    );
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      calls.push({
        url: String(url),
        body: JSON.parse(String(init?.body || '{}')),
      });
      return {
        ok: true,
        status: 200,
        json: async () => ({ id: 'mail' }),
        text: async () => '{}',
      } as Response;
    }) as typeof fetch;
    const result = await service.generateAndSend('2026-09-25', {
      articles: [],
      fetchImpl,
    });
    expect(result.status).toBe('sent');
    expect(result.recipients).toEqual(['desk@example.com']);
    expect(calls.map((call) => call.url)).toEqual([
      'https://api.resend.com/emails',
    ]);
    expect(calls[0].body.subject).toBe(
      'MediaSphere Daily Constituency Report - 25 September 2026',
    );
    expect(
      (calls[0].body.attachments as Array<{ filename: string }>)[0].filename,
    ).toBe('Daily_Report_2026_09_25.pdf');
    expect(result.notifications?.results.map((row) => row.channel)).toEqual([
      'email',
      'whatsapp',
    ]);
    expect(sent).toEqual([1]);
  });

  it('builds a report without Mongo when email and WhatsApp are disabled', async () => {
    const stored: Array<Record<string, unknown>> = [];
    const repo = {
      alreadySent: async () => false,
      recordGeneration: async (
        day: string,
        stats: { total?: number },
        recipients: string[],
        pdfPath: string,
      ) => {
        stored.push({
          day,
          total: stats.total,
          recipients,
          pdfPath,
          status: 'pending',
        });
        return null;
      },
      recordFailed: async (day: string, retry: number, error: string) => {
        stored.push({ day, retry, error, status: 'failed' });
        return null;
      },
      recordSent: async () => null,
    };
    const articles = {
      findAll: async () => {
        throw new Error('mongo read');
      },
    };
    const service = new ReportsService(
      repo as unknown as DailyReportRepository,
      articles as unknown as ArticleRepository,
    );
    const article = enrichArticle(
      normalizeArticle({
        title: 'Water supply',
        summary: 'Tanks are empty',
        category: 'Water',
        sentiment: 'Problem',
        location: { mandal: 'Narasaraopet' },
        created_on: '2026-09-25T09:00:00+05:30',
      }),
    );
    const fetchImpl = (async () => {
      throw new Error('network');
    }) as typeof fetch;
    const result = await service.generateAndSend('2026-09-25', {
      articles: [article],
      fetchImpl,
    });
    expect(result.status).toBe('failed');
    expect(result.error).toBe(
      'email_skipped: email_disabled; whatsapp_skipped: whatsapp_disabled_or_misconfigured',
    );
    expect(result.articles_included).toBe(1);
    expect(result.subject).toBe(
      'MediaSphere Daily Constituency Report - 25 September 2026',
    );
    expect(String(result.pdf_path)).toContain('Daily_Report_2026_09_25.pdf');
    expect(stored.some((row) => row.status === 'pending')).toBe(true);
    expect(stored.some((row) => row.error === result.error)).toBe(true);
  });

  it('does not arm the scheduler while Flask is the sender', () => {
    const config = {
      get: (key: string) => (key === 'reports.schedulerOnApi' ? false : true),
    } as ConfigService;
    let generated = false;
    const reports = {
      generateAndSend: async () => {
        generated = true;
        return { status: 'sent' };
      },
    };
    const scheduler = new ReportsSchedulerService(
      config,
      {} as SchedulerRegistry,
      reports as unknown as ReportsService,
    );
    scheduler.onModuleInit();
    expect(generated).toBe(false);
  });
});
