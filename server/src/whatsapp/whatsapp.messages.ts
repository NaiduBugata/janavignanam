export function locationLabel(article: Record<string, unknown>): string {
  const location = article.location;
  if (location && typeof location === 'object' && !Array.isArray(location)) {
    for (const key of ['village', 'mandal', 'town', 'district']) {
      const value = String(
        (location as Record<string, unknown>)[key] || '',
      ).trim();
      if (value && value.toLowerCase() !== 'unknown') return value;
    }
  }
  return 'Narasaraopet';
}

export function isCriticalArticle(article: Record<string, unknown>): boolean {
  const sentiment = String(article.sentiment || '')
    .trim()
    .toLowerCase();
  const severity = String(article.severity || '')
    .trim()
    .toLowerCase();
  return (
    (sentiment === 'negative' || sentiment === 'problem') && severity === 'high'
  );
}

function clip(value: string, max: number): string {
  return value.length <= max ? value : value.slice(0, max);
}

export function articleTemplateVariables(
  article: Record<string, unknown>,
): string[] {
  const title = clip(String(article.title || 'Untitled'), 120);
  const summary = clip(String(article.summary || article.problem || ''), 180);
  const critical = isCriticalArticle(article);
  const problem = critical
    ? summary || title
    : clip(`New article: ${title}${summary ? ` — ${summary}` : ''}`, 200);
  const source = String(article.source || 'MediaSphere');
  const priority = critical
    ? String(article.severity || 'HIGH').toUpperCase() || 'HIGH'
    : 'INFO';
  return [
    locationLabel(article),
    problem || 'New article collected successfully.',
    priority,
    source,
    new Date().toISOString(),
  ];
}

export function articleAlertText(article: Record<string, unknown>): string {
  if (isCriticalArticle(article)) {
    return [
      'CRITICAL ISSUE',
      `Location: ${locationLabel(article)}`,
      `Problem: ${String(article.problem || article.summary || 'High-priority negative issue detected')}`,
      `Priority: ${String(article.severity || 'HIGH').toUpperCase()}`,
      `Source: ${String(article.source || 'unknown')}`,
      'MediaSphere Intelligence Platform',
    ].join('\n');
  }
  return [
    'NEW NEWS DETECTED',
    `Source: ${String(article.source || 'unknown')}`,
    `Location: ${locationLabel(article)}`,
    `Category: ${String(article.category || 'News')}`,
    `Sentiment: ${String(article.sentiment || 'Neutral')}`,
    `Headline: ${String(article.title || 'Untitled')}`,
    `Summary: ${String(article.summary || 'N/A')}`,
    'MediaSphere Intelligence Platform',
  ].join('\n');
}

export function summaryText(
  stats: Record<string, unknown>,
  reportDate: string,
): string {
  const total = stats.total || stats.article_count || 0;
  const positive = stats.positive_count || stats.positive || 0;
  const negative = stats.negative_count || stats.negative || 0;
  const neutral = stats.neutral_count || stats.neutral || 0;
  const problems =
    stats.problem_count || stats.problems || stats.high_priority_problems || 0;
  const categories = stats.category || stats.top_categories || {};
  const locations = stats.district || stats.top_locations || {};
  const topCat =
    typeof categories === 'object' && categories
      ? Object.entries(categories as Record<string, unknown>)
          .slice(0, 5)
          .map(([key, value]) => `${key} (${value})`)
          .join(', ') || 'N/A'
      : String(categories || 'N/A');
  const topLoc =
    typeof locations === 'object' && locations
      ? Object.entries(locations as Record<string, unknown>)
          .slice(0, 5)
          .map(([key, value]) => `${key} (${value})`)
          .join(', ') || 'N/A'
      : String(locations || 'N/A');
  return [
    'DAILY NEWS SUMMARY',
    `Date: ${reportDate}`,
    `Articles: ${total}`,
    `Positive: ${positive}`,
    `Negative: ${negative}`,
    `Neutral: ${neutral}`,
    `Top Categories: ${topCat}`,
    `Top Locations: ${topLoc}`,
    `Critical Issues: ${problems}`,
    `Dashboard: ${process.env.DASHBOARD_URL || 'N/A'}`,
    'Generated automatically by MediaSphere.',
  ].join('\n');
}

export function pipelineStatusText(stats: Record<string, unknown>): string {
  return [
    'PIPELINE COMPLETED',
    'News fetched successfully.',
    `Articles Collected: ${stats.articles_fetched || stats.fetched || 0}`,
    `AI Processed: ${stats.total || 0}`,
    `Stored (inserted): ${stats.inserted || 0}`,
    `Duplicates: ${stats.duplicates || 0}`,
    `Lokal: ${stats.lokal_processed ?? '—'}`,
    `YouTube: ${stats.youtube_processed ?? '—'}`,
    `Sakshi: ${stats.sakshi_processed ?? '—'}`,
    `Email Sent: ${stats.email_sent ?? '—'}`,
    `WhatsApp Sent: ${stats.whatsapp_sent ?? '—'}`,
    `Execution Time: ${stats.duration_seconds ?? '—'}s`,
    `Status: ${stats.status || 'Finished Successfully'}`,
    'MediaSphere Intelligence Platform',
  ].join('\n');
}

export function failureText(
  module: string,
  reason: string,
  retryStatus = 'N/A',
): string {
  return [
    'PIPELINE FAILURE',
    `Module: ${module || 'unknown'}`,
    'Status: FAILED',
    `Reason: ${(reason || 'Unknown error').slice(0, 500)}`,
    `Retry Status: ${retryStatus || 'N/A'}`,
    'Server: MediaSphere',
    'MediaSphere Intelligence Platform',
  ].join('\n');
}

export function healthText(checks: Record<string, string>): string {
  const ok = Object.values(checks).every((value) =>
    ['ok', 'healthy', 'connected', 'running', 'ready', 'true'].includes(
      value.toLowerCase(),
    ),
  );
  return [
    'MediaSphere Health Report',
    ...Object.entries(checks).map(([name, status]) => `${name}: ${status}`),
    ok ? 'Everything Healthy' : 'Attention required — see statuses above.',
    'MediaSphere Intelligence Platform',
  ].join('\n');
}

export function summaryVariables(text: string): string[] {
  const compact = clip(text.replace(/\s+/g, ' ').trim(), 200);
  return [
    'Narasaraopet',
    compact || 'MediaSphere notification',
    'INFO',
    'MediaSphere',
    new Date().toISOString(),
  ];
}
