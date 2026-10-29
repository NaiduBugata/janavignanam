import { SAKSHI_USER_AGENT } from './sakshi.constants';

const SEGMENT_LABEL: Record<string, string> = {
  narasaraopet: 'Narasaraopet',
  chilakaluripet: 'Chilakaluripet',
  sattenapalle: 'Sattenapalle',
  sattenapalli: 'Sattenapalle',
  vinukonda: 'Vinukonda',
  gurazala: 'Gurazala',
  macherla: 'Macherla',
  pedakurapadu: 'Pedakurapadu',
};

export interface FeedHeadline {
  title: string;
  link: string;
  published: string | null;
  segment: string;
}

export function segmentFromTagUrl(url: string): string {
  try {
    const tag = new URL(url).pathname.split('/').filter(Boolean).pop() || '';
    return SEGMENT_LABEL[tag] || '';
  } catch {
    return '';
  }
}

export function googleNewsSearchUrl(tagUrl: string): string {
  const tag = (() => {
    try {
      return (
        new URL(tagUrl).pathname.split('/').filter(Boolean).pop() ||
        'narasaraopet'
      );
    } catch {
      return 'narasaraopet';
    }
  })();
  return `https://news.google.com/rss/search?q=${encodeURIComponent(`site:sakshi.com ${tag} when:2d`)}&hl=te&gl=IN&ceid=IN:te`;
}

function decodeXml(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/** Headlines from the public news feed. Used when Sakshi's own site refuses the server. */
export function parseGoogleNewsItems(
  xml: string,
  segment: string,
): FeedHeadline[] {
  const headlines: FeedHeadline[] = [];
  for (const block of xml.split('<item>').slice(1)) {
    const title = decodeXml(
      (block.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '',
    ).replace(/\s+-\s+sakshi\.com\s*$/i, '');
    const link = decodeXml(
      (block.match(/<link>([\s\S]*?)<\/link>/) || [])[1] || '',
    );
    const pub = decodeXml(
      (block.match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [])[1] || '',
    );
    const published =
      pub && !Number.isNaN(Date.parse(pub))
        ? new Date(pub).toISOString()
        : null;
    if (!title || !link) continue;
    headlines.push({ title, link, published, segment });
  }
  return headlines;
}

export async function fetchSegmentHeadlines(
  tagUrl: string,
  fetchImpl: typeof fetch,
): Promise<FeedHeadline[]> {
  const segment = segmentFromTagUrl(tagUrl);
  if (!segment) return [];
  const response = await fetchImpl(googleNewsSearchUrl(tagUrl), {
    headers: {
      'User-Agent': SAKSHI_USER_AGENT,
      Accept: 'application/rss+xml, application/xml, text/xml, */*',
    },
  });
  if (!response.ok) return [];
  return parseGoogleNewsItems(await response.text(), segment);
}
