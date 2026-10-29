export interface NewsBrief {
  title: string;
  summary: string;
  category: string;
  sentiment: string;
  severity: string;
  place: string;
  source: string;
  url: string;
  publishedAt: string;
  collectedAt: string;
}

const STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'any',
  'are',
  'about',
  'at',
  'can',
  'do',
  'for',
  'from',
  'give',
  'i',
  'in',
  'is',
  'it',
  'latest',
  'me',
  'my',
  'news',
  'new',
  'of',
  'on',
  'or',
  'please',
  'recent',
  'show',
  'tell',
  'the',
  'there',
  'to',
  'today',
  'update',
  'updates',
  'what',
  'whats',
  'with',
  'you',
]);

export function toBrief(doc: Record<string, unknown>): NewsBrief | null {
  const title = text(doc.title);
  const summary = text(doc.summary);
  if (!title && !summary) return null;
  const location =
    doc.location && typeof doc.location === 'object'
      ? (doc.location as Record<string, unknown>)
      : {};
  const place = [
    location.village,
    location.town,
    location.mandal,
    location.district,
  ]
    .map(text)
    .filter((value, index, all) => value && all.indexOf(value) === index)
    .join(', ');
  return {
    title,
    summary,
    category: text(doc.category),
    sentiment: text(doc.sentiment),
    severity: text(doc.severity),
    place,
    source: text(doc.source) || 'lokal',
    url: text(doc.source_url),
    publishedAt: text(doc.created_on),
    collectedAt: text(doc.first_seen_at),
  };
}

export function newestFirst(briefs: NewsBrief[]): NewsBrief[] {
  return [...briefs].sort((left, right) => timeOf(right) - timeOf(left));
}

/** The newest articles, plus older ones that mention words from the question. */
export function selectNews(
  briefs: readonly NewsBrief[],
  question: string,
  options: { recent?: number; matches?: number } = {},
): NewsBrief[] {
  const sorted = newestFirst([...briefs]);
  const picked = sorted.slice(0, options.recent ?? 15);
  const tokens = tokenize(question).filter(
    (token) => token.length > 2 && !STOP_WORDS.has(token),
  );
  if (!tokens.length) return picked;
  const matched = sorted
    .slice(picked.length)
    .map((brief) => ({ brief, score: score(brief, tokens) }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, options.matches ?? 8)
    .map((item) => item.brief);
  return [...picked, ...matched];
}

export function formatNews(
  briefs: readonly NewsBrief[],
  total: number,
): string {
  if (!briefs.length) return 'No news articles are stored yet.';
  const lines = briefs.map((brief, index) => {
    const tags = [
      shortDate(brief.publishedAt || brief.collectedAt),
      brief.category,
      brief.severity && `severity ${brief.severity}`,
      brief.sentiment,
    ]
      .filter(Boolean)
      .join(', ');
    return [
      `${index + 1}. [${tags}] ${clip(brief.title, 140)}`,
      brief.summary ? `   Summary: ${clip(brief.summary, 360)}` : '',
      brief.place ? `   Place: ${brief.place}` : '',
      `   Source: ${brief.source}${brief.url ? ` ${brief.url}` : ''}`,
    ]
      .filter(Boolean)
      .join('\n');
  });
  return [`${total} articles are stored. Newest first:`, ...lines].join('\n');
}

function score(brief: NewsBrief, tokens: string[]): number {
  const haystack = new Set(
    tokenize(
      `${brief.title} ${brief.summary} ${brief.category} ${brief.place} ${brief.source}`,
    ),
  );
  return tokens.filter((token) => haystack.has(token)).length;
}

function timeOf(brief: NewsBrief): number {
  for (const value of [brief.publishedAt, brief.collectedAt]) {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return 0;
}

function shortDate(value: string): string {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return '';
  return new Date(parsed).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Kolkata',
  });
}

function tokenize(value: string): string[] {
  return [
    ...new Set(
      value
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .split(/\s+/)
        .filter(Boolean),
    ),
  ];
}

function clip(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1).trimEnd()}…`;
}

function text(value: unknown): string {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  return trimmed === 'null' ? '' : trimmed;
}
