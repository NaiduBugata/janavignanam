import {
  constituencyName,
  formatGeneratedAt,
  formatLocation,
  formatLongDate,
  type ReportArticle,
  type ReportStats,
} from './report-stats';

const PRIMARY = '#1E3A8A';
const SECONDARY = '#F8FAFC';
const BORDER = '#E2E8F0';

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function section(title: string): string {
  return `<h2 style="margin:24px 0 8px;font-size:16px;color:${PRIMARY};border-bottom:1px solid ${BORDER};padding-bottom:6px;">${escapeHtml(title)}</h2>`;
}

function rows(items: Array<[string, string]>): string {
  return items
    .map(
      ([label, value]) =>
        `<tr><td style="padding:6px 8px;border-bottom:1px solid ${BORDER};">${escapeHtml(label)}</td>` +
        `<td style="padding:6px 8px;border-bottom:1px solid ${BORDER};">${escapeHtml(value)}</td></tr>`,
    )
    .join('');
}

export function buildEmailHtml(
  target: string,
  generatedAt: Date,
  articles: ReportArticle[],
  stats: ReportStats,
  summary: string,
): string {
  const name = constituencyName();
  const action = stats.action_items
    .map(
      (item) =>
        `<li><strong>[${escapeHtml(item.priority)}]</strong> ${escapeHtml(item.title)} — ${escapeHtml(item.department)}</li>`,
    )
    .join('');
  const positive = stats.positive_items
    .map((item) => `<li>${escapeHtml(item.title)}</li>`)
    .join('');
  const digest = articles
    .map(
      (article) =>
        `<p><strong>${escapeHtml(article.title)}</strong><br/>${escapeHtml(article.summary)}<br/>` +
        `<span style="color:#6B7280;">${escapeHtml(article.category)} · ${escapeHtml(formatLocation(article.location))}</span></p>`,
    )
    .join('');
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/><title>MediaSphere Daily Constituency Report</title></head>
<body style="margin:0;padding:16px;background:${SECONDARY};font-family:Arial,Helvetica,sans-serif;color:#1F2937;">
<table role="presentation" width="640" cellpadding="0" cellspacing="0" style="max-width:640px;background:#fff;border:1px solid ${BORDER};border-radius:12px;">
<tr><td style="background:${PRIMARY};color:#fff;padding:24px;">
<div style="font-size:22px;font-weight:800;">MediaSphere</div>
<div>Daily Constituency Report — ${escapeHtml(name)}</div>
<div>${escapeHtml(formatLongDate(target))}</div>
</td></tr>
<tr><td style="padding:8px 24px 24px;">
${section('Executive Summary')}
<p>${escapeHtml(summary)}</p>
${section('Key Metrics')}
<table width="100%">${rows([
    ['Total Articles', String(stats.total)],
    ['Positive News', String(stats.positive)],
    ['Negative News', String(stats.negative)],
    ['Problems Identified', String(stats.problems)],
    ['High Priority', String(stats.high_priority_problems)],
  ])}</table>
${section('Action Required')}
${action ? `<ul>${action}</ul>` : '<p>None</p>'}
${section('Positive Developments')}
${positive ? `<ul>${positive}</ul>` : '<p>None</p>'}
${section('Category Summary')}
<table width="100%">${rows(stats.category_summary.map((item) => [item.name, String(item.count)]))}</table>
${section('Location Summary')}
<table width="100%">${rows([
    ['Most Affected District', stats.most_affected_district],
    ['Most Affected Mandal', stats.most_affected_mandal],
    ['Most Affected Village', stats.most_affected_village],
  ])}</table>
${section('Sentiment Summary')}
<table width="100%">${rows([
    ['Positive', `${stats.sentiment_pct.Positive}%`],
    ['Negative', `${stats.sentiment_pct.Negative}%`],
    ['Statement', `${stats.sentiment_pct.Statement}%`],
    ['Neutral', `${stats.sentiment_pct.Neutral}%`],
  ])}</table>
${section('Top Keywords')}
<p>${escapeHtml(stats.top_keywords.map((item) => item.name).join(', ') || 'None')}</p>
${section('Top Entities')}
<p>${escapeHtml(stats.top_entities.map((item) => item.name).join(', ') || 'None')}</p>
${section('Article Digest')}
${digest || '<p>No articles.</p>'}
<p style="color:#6B7280;font-size:12px;">Generated ${escapeHtml(formatGeneratedAt(generatedAt))} for ${escapeHtml(name)} constituency.</p>
</td></tr></table></body></html>`;
}
