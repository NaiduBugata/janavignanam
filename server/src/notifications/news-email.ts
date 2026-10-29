import { sendReportEmail, type EmailSendResult } from '../reports/report-email';
import {
  isCriticalArticle,
  locationLabel,
} from '../whatsapp/whatsapp.messages';

const MAX_LISTED = 50;

export function newsEmailEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return ['1', 'true', 'yes', 'on'].includes(
    (env.NEWS_EMAIL_ENABLED ?? 'true').trim().toLowerCase(),
  );
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function istStamp(at: Date): string {
  return at.toLocaleString('en-IN', {
    timeZone: process.env.REPORT_TIMEZONE || 'Asia/Kolkata',
    hour12: true,
  });
}

function safeLink(value: unknown): string {
  const url = typeof value === 'string' ? value.trim() : '';
  return /^https?:\/\//i.test(url) ? url : '';
}

function articleBlock(article: Record<string, unknown>, at: Date): string {
  const critical = isCriticalArticle(article);
  const title = String(article.title || 'Untitled');
  const problem = String(
    (critical ? article.problem || article.summary : article.summary) || '',
  );
  const priority = critical
    ? String(article.severity || 'HIGH').toUpperCase()
    : 'INFO';
  const link = safeLink(article.source_url);
  const rows: Array<[string, string]> = [
    ['Location', locationLabel(article)],
    [critical ? 'Problem' : 'Summary', problem || '—'],
    ['Priority', priority],
    ['Source', String(article.source || 'MediaSphere')],
    ['Detected at', `${istStamp(at)} IST`],
  ];
  const border = critical ? '#dc2626' : '#d1d5db';
  return (
    `<div style="border-left:4px solid ${border};padding:8px 12px;margin:0 0 14px">` +
    `<p style="margin:0 0 6px;font-weight:bold">${critical ? 'CRITICAL ISSUE: ' : ''}${escapeHtml(title)}</p>` +
    rows
      .map(
        ([label, value]) =>
          `<div><strong>${label}:</strong> ${escapeHtml(value)}</div>`,
      )
      .join('') +
    (link
      ? `<div><a href="${escapeHtml(link)}">Open the article</a></div>`
      : '') +
    `</div>`
  );
}

/** One email per pipeline cycle listing every article it added; critical issues come first. */
export function newsEmailContent(
  articles: Array<Record<string, unknown>>,
  at: Date,
): { subject: string; html: string } {
  const sorted = [...articles].sort(
    (a, b) => Number(isCriticalArticle(b)) - Number(isCriticalArticle(a)),
  );
  const critical = sorted.filter(isCriticalArticle).length;
  const count = `${articles.length} new article${articles.length === 1 ? '' : 's'}`;
  const listed = sorted
    .slice(0, MAX_LISTED)
    .map((article) => articleBlock(article, at))
    .join('');
  const more =
    sorted.length > MAX_LISTED
      ? `<p>…and ${sorted.length - MAX_LISTED} more on the dashboard.</p>`
      : '';
  const dashboard = process.env.DASHBOARD_URL
    ? `<p><a href="${escapeHtml(process.env.DASHBOARD_URL)}">Open the dashboard</a></p>`
    : '';
  return {
    subject: `MediaSphere: ${count}${critical ? `, ${critical} critical` : ''} | ${istStamp(at)} IST`,
    html:
      `<h2>${critical ? 'Critical issue detected' : 'New news detected'}</h2>` +
      `<p>${escapeHtml(count)} added in this pipeline cycle${critical ? `, ${critical} marked critical` : ''}.</p>` +
      listed +
      more +
      dashboard +
      `<p style="color:#6b7280">MediaSphere Intelligence Platform</p>`,
  };
}

export async function sendNewArticlesEmail(input: {
  articles: Array<Record<string, unknown>>;
  at?: Date;
  fetchImpl?: typeof fetch;
}): Promise<EmailSendResult> {
  if (!input.articles.length) {
    return {
      channel: 'email',
      success: true,
      skipped: true,
      skip_reason: 'no_new_articles',
      error: null,
      attempts: 0,
    };
  }
  if (!newsEmailEnabled()) {
    return {
      channel: 'email',
      success: true,
      skipped: true,
      skip_reason: 'news_email_disabled',
      error: null,
      attempts: 0,
    };
  }
  const { subject, html } = newsEmailContent(
    input.articles,
    input.at || new Date(),
  );
  return sendReportEmail(
    subject,
    html,
    null,
    undefined,
    input.fetchImpl || fetch,
  );
}
