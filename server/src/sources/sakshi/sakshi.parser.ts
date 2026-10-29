import { createHash } from 'node:crypto';
import {
  ASSEMBLY_SEGMENTS,
  constituencyKeywords,
} from '../../pipeline/native/constituency';
import {
  SAKSHI_NON_LOCAL_PATH_MARKERS,
  SAKSHI_SKIP_URL_SUBSTRINGS,
} from './sakshi.constants';

const FALLBACK_KEYWORDS = [...ASSEMBLY_SEGMENTS, 'నరసరావుపేట'];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function isSkipUrl(url: string): boolean {
  const lowered = url.toLowerCase();
  return SAKSHI_SKIP_URL_SUBSTRINGS.some((token) => lowered.includes(token));
}

/** Port of sources/sakshi/parser.py::_is_article_url. */
export function isArticleUrl(url: string): boolean {
  if (!url || isSkipUrl(url)) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  if (!parsed.hostname.toLowerCase().includes('sakshi.com')) return false;
  const path = parsed.pathname || '';
  if (
    path.includes('/tags/') ||
    path.includes('/category/') ||
    path.replace(/\/+$/, '') === ''
  ) {
    return false;
  }
  const lowered = path.toLowerCase();
  if (
    [
      '/news/',
      '/telugu-news/',
      '/andhra-pradesh/',
      '/ap/',
      '/guntur/',
      '/article/',
      '/politics/',
      '/crime/',
    ].some((token) => lowered.includes(token))
  ) {
    return true;
  }
  const slug =
    path
      .replace(/^\/+|\/+$/g, '')
      .split('/')
      .pop() || '';
  return (
    Boolean(slug) && slug.length > 12 && !/\.(jpg|png|gif|mp4)$/i.test(slug)
  );
}

export function loadUrlPriorityKeywords(): string[] {
  try {
    const keywords = constituencyKeywords();
    return keywords.length ? keywords : FALLBACK_KEYWORDS;
  } catch {
    return FALLBACK_KEYWORDS;
  }
}

/**
 * Match a constituency place in the URL or anchor.
 * Short Latin tokens are ignored so "Ipur" does not match "jaipur".
 */
export function urlHasLocationKeyword(
  url: string,
  anchorText: string,
  keywords: string[],
): boolean {
  const combined = `${url} ${anchorText}`;
  const haystack = combined.toLowerCase();
  for (const keyword of keywords) {
    if (!keyword.trim()) continue;
    if ([...keyword].some((ch) => ch.charCodeAt(0) > 127)) {
      if (combined.includes(keyword)) return true;
      continue;
    }
    const token = keyword.toLowerCase().trim();
    const compact = token.replace(/[\s_-]+/g, '');
    if (compact.length < 5) continue;
    const bounded = (value: string) =>
      new RegExp(`(?<![a-z0-9])${escapeRegExp(value)}(?![a-z0-9])`);
    if (bounded(token).test(haystack)) return true;
    const squashed = haystack.replace(/[-_]/g, '');
    if (compact && bounded(compact).test(squashed)) return true;
  }
  return false;
}

export function isSectionHubUrl(url: string): boolean {
  let path = '';
  try {
    path = new URL(url).pathname.replace(/^\/+|\/+$/g, '');
  } catch {
    return true;
  }
  if (!path) return true;
  const parts = path.split('/');
  const slug = parts[parts.length - 1] || '';
  if (parts.length <= 2 && !/\d{5,}/.test(slug)) return true;
  if (slug.length < 20 && !/\d{5,}/.test(slug)) return true;
  return false;
}

/** Higher score is fetched earlier. Only 100 (a constituency place name) is kept. */
export function linkPriority(
  url: string,
  anchorText = '',
  keywords?: string[],
): number {
  const terms = keywords || loadUrlPriorityKeywords();
  const path = (() => {
    try {
      return new URL(url).pathname.toLowerCase();
    } catch {
      return '';
    }
  })();
  if (urlHasLocationKeyword(url, anchorText, terms)) return 100;
  if (SAKSHI_NON_LOCAL_PATH_MARKERS.some((marker) => path.includes(marker)))
    return 0;
  if (
    ['/andhra-pradesh/', '/politics/', '/crime/', '/guntur/', '/palnadu/'].some(
      (token) => path.includes(token),
    )
  ) {
    return 40;
  }
  if (path.includes('/telugu-news/') || path.includes('/news/')) return 20;
  return 10;
}

export function stableArticleId(url: string): string {
  let path = '';
  try {
    path = new URL(url).pathname.replace(/^\/+|\/+$/g, '');
  } catch {
    path = '';
  }
  const slug = path ? path.replaceAll('/', '_') : 'unknown';
  const digest = createHash('sha1')
    .update(url, 'utf8')
    .digest('hex')
    .slice(0, 10);
  const cleaned =
    slug.replace(/[^a-zA-Z0-9_-]+/g, '').slice(0, 80) || 'article';
  return `${cleaned}_${digest}`;
}

export function parseSakshiDatetime(
  value: string | null | undefined,
): string | null {
  if (!value) return null;
  const text = value.trim();
  if (!text) return null;
  if (
    !Number.isNaN(Date.parse(text)) &&
    (text.includes('T') || /^\d{4}-\d{2}-\d{2}/.test(text))
  ) {
    return text;
  }
  return null;
}

export function resolveSakshiUrl(href: string, baseUrl: string): string {
  const absolute = new URL(href, `${baseUrl}/`).toString();
  return absolute.split('#')[0];
}

export function collapseText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}
