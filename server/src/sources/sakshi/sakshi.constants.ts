/** Sakshi collector settings. Defaults match server/sources/sakshi/config.py. */

function intEnv(name: string, fallback: number, min = 0): number {
  const raw = process.env[name];
  if (raw == null || raw.trim() === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.trunc(parsed));
}

function floatEnv(name: string, fallback: number, min = 0): number {
  const raw = process.env[name];
  if (raw == null || raw.trim() === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, parsed);
}

export function sakshiEnabled(): boolean {
  const raw = (process.env.SAKSHI_ENABLED || 'true').toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

/** Tag pages for the seven assembly segments. Sattenapalle and Sattenapalli are two spellings Sakshi tags separately. */
const SEGMENT_TAGS = [
  'narasaraopet',
  'chilakaluripet',
  'sattenapalle',
  'sattenapalli',
  'vinukonda',
  'gurazala',
  'macherla',
  'pedakurapadu',
];

/** First tag page, kept for the envelope `source` field. */
export function sakshiTagUrl(): string {
  return sakshiTagUrls()[0];
}

/** The only listings the collector downloads. `SAKSHI_TAG_URLS` (comma-separated) or `SAKSHI_TAG_URL` override the segment tags. */
export function sakshiTagUrls(): string[] {
  const list = (process.env.SAKSHI_TAG_URLS || process.env.SAKSHI_TAG_URL || '')
    .split(',')
    .map((url) => url.trim())
    .filter(Boolean);
  return list.length
    ? list
    : SEGMENT_TAGS.map((tag) => `https://www.sakshi.com/tags/${tag}`);
}

export function sakshiBaseUrl(): string {
  return (process.env.SAKSHI_BASE_URL || 'https://www.sakshi.com').replace(
    /\/+$/,
    '',
  );
}

export function sakshiRequestDelayMs(): number {
  return Math.round(floatEnv('SAKSHI_REQUEST_DELAY_SECONDS', 1.5, 0.5) * 1000);
}

export function sakshiTimeoutMs(): number {
  return intEnv('SAKSHI_TIMEOUT_SECONDS', 30, 5) * 1000;
}

export function sakshiMaxArticles(): number {
  return intEnv('SAKSHI_MAX_ARTICLES_PER_RUN', 20, 1);
}

export function sakshiMaxRetries(): number {
  return intEnv('SAKSHI_MAX_RETRIES', 3, 1);
}

export const SAKSHI_COLLECTOR_NAME = 'Sakshi News Collector';
export const SAKSHI_USER_AGENT =
  process.env.SAKSHI_USER_AGENT ||
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export const SAKSHI_HEADERS: Record<string, string> = {
  'User-Agent': SAKSHI_USER_AGENT,
  Accept:
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'te-IN,te;q=0.9,en-US;q=0.8,en;q=0.7',
  Referer: 'https://www.sakshi.com/',
  'Upgrade-Insecure-Requests': '1',
};

export function sakshiLinkSelector(): string {
  return process.env.SAKSHI_ARTICLE_LINK_SELECTOR || 'a[href]';
}

export function sakshiBodySelector(): string {
  return (
    process.env.SAKSHI_ARTICLE_BODY_SELECTOR ||
    'div.news-story-content, div.news-story-body, div.story-content, div.article-content, article .content, div#storyBody, div.field-name-body'
  );
}

export function sakshiTitleSelector(): string {
  return (
    process.env.SAKSHI_TITLE_SELECTOR ||
    'h1.story-title, h1.article-title, h1.title, h1'
  );
}

export function sakshiNoiseSelector(): string {
  return (
    process.env.SAKSHI_NOISE_SELECTOR ||
    'header, footer, nav, aside, form, script, style, noscript, .detail_aside, .header_top_row, .trending_news, .trending_results, .search_results_dropdown, .search_dialog, .related_news, .related-news, .more_news, .most_read, .photo_gallery, .web_stories, .taboola, .advertisement'
  );
}

export const SAKSHI_TRANSIENT_STATUSES = new Set([500, 502, 503, 504]);
export const SAKSHI_PERMANENT_STATUSES = new Set([400, 404]);

export const SAKSHI_SKIP_URL_SUBSTRINGS = [
  '/videos/',
  '/video/',
  '/gallery/',
  '/photo/',
  '/photos/',
  '/advertise',
  '/ads/',
  'javascript:',
  'mailto:',
  '#',
];

export const SAKSHI_NON_LOCAL_PATH_MARKERS = [
  '/sports/',
  '/business/',
  '/cartoon/',
  '/national/',
  '/international/',
  '/family/',
  '/cinema/',
  '/entertainment/',
  '/technology/',
  '/astrology/',
  '/movies/',
  '/tollywood/',
  '/editorial/',
];
