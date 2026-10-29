import { isReligionStory } from '../../pipeline/native/religion';

/** Port of sources/youtube/parser.py TranscriptCleaner and caption text parsing. */

const NEWS_CHANNELS = [
  'tv9',
  'ntv',
  'abn',
  'sakshi',
  'etv',
  'prime9',
  'tv5',
  'rtv',
  'inews',
  'big tv',
  'cvr',
  'sumantv',
  '10tv',
  'hmtv',
  't news',
  'v6',
];

const NON_NEWS_KEYWORDS = [
  'shorts',
  'drone',
  'aerial',
  'plots',
  'sale',
  'shopping',
  'movie',
  'trailer',
  'song',
  'marriage',
  'wedding',
  'comedy',
  'dance',
  'cooking',
  'recipe',
  'makeup',
  'fashion',
  'gaming',
  'unboxing',
  'review',
  'reaction',
  'prank',
  'challenge',
];

const NEWS_INDICATORS = [
  'న్యూస్',
  'వార్తలు',
  'నివేదిక',
  'ఘటన',
  'సంఘటన',
  'ప్రమాదం',
  'మృతి',
  'హత్య',
  'అరెస్ట్',
  'పోలీస్',
  'కోర్టు',
  'ప్రభుత్వం',
  'మంత్రి',
  'ఎమ్మెల్యే',
  'ఎన్నికలు',
  'సభ',
  'సమావేశం',
  'ధర్నా',
  'ప్రదర్శన',
];

const TV_FILLER = [
  /మా\s*ప్రతినిధి/g,
  /మరిన్ని\s*వివరాలు/g,
  /subscribe/gi,
  /like\s+and\s+share/gi,
];

export interface CleanResult {
  is_news: boolean;
  clean_text: string;
}

export function isNewsContent(
  title: string,
  channel: string,
  transcript: string,
): boolean {
  const titleLower = (title || '').toLowerCase();
  const channelLower = (channel || '').toLowerCase();
  const isNewsChannel = NEWS_CHANNELS.some((name) =>
    channelLower.includes(name),
  );
  const hasNonNews = NON_NEWS_KEYWORDS.some((word) =>
    titleLower.includes(word),
  );
  if (isReligionStory(title, transcript)) return false;
  const hasIndicators = NEWS_INDICATORS.some((word) =>
    transcript.includes(word),
  );
  if (isNewsChannel && !hasNonNews) return true;
  return hasIndicators && !hasNonNews;
}

export function cleanTranscript(
  transcript: string,
  title: string,
  channel: string,
): CleanResult {
  const raw = transcript || '';
  const isNews = isNewsContent(title, channel, raw);
  if (!isNews) return { is_news: false, clean_text: '' };
  let cleaned = raw.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
  for (const pattern of TV_FILLER) cleaned = cleaned.replace(pattern, '');
  return { is_news: true, clean_text: cleaned.trim() };
}

export function toRfc3339(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export interface CaptionTrack {
  baseUrl: string;
  languageCode: string;
}

export function extractCaptionTracks(html: string): CaptionTrack[] {
  const marker = '"captionTracks":';
  const start = html.indexOf(marker);
  if (start < 0) return [];
  const bracket = html.indexOf('[', start);
  if (bracket < 0) return [];
  let depth = 0;
  for (let index = bracket; index < html.length; index += 1) {
    const char = html[index];
    if (char === '[') depth += 1;
    else if (char === ']') {
      depth -= 1;
      if (depth === 0) {
        try {
          const parsed = JSON.parse(html.slice(bracket, index + 1)) as Array<{
            baseUrl?: string;
            languageCode?: string;
          }>;
          if (!Array.isArray(parsed)) return [];
          return parsed
            .filter((row) => row && typeof row.baseUrl === 'string')
            .map((row) => ({
              baseUrl: String(row.baseUrl),
              languageCode: String(row.languageCode || ''),
            }));
        } catch {
          return [];
        }
      }
    }
  }
  return [];
}

function decodeXml(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_, code: string) =>
      String.fromCodePoint(Number(code)),
    )
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/** Timedtext XML or YouTube json3 caption payload to plain text. */
export function parseCaptionText(payload: string): string {
  const trimmed = payload.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('{')) {
    try {
      const body = JSON.parse(trimmed) as {
        events?: Array<{ segs?: Array<{ utf8?: string }> }>;
      };
      const parts: string[] = [];
      for (const event of body.events || []) {
        for (const seg of event.segs || []) {
          if (seg.utf8) parts.push(seg.utf8);
        }
      }
      return parts.join(' ').replace(/\s+/g, ' ').trim();
    } catch {
      return '';
    }
  }
  const textTags = [...trimmed.matchAll(/<text[^>]*>([\s\S]*?)<\/text>/g)].map(
    (match) => decodeXml(match[1].replace(/<[^>]+>/g, '')),
  );
  if (textTags.length) return textTags.join(' ').replace(/\s+/g, ' ').trim();
  const spoken = [...trimmed.matchAll(/<s[^>]*>([\s\S]*?)<\/s>/g)].map(
    (match) => decodeXml(match[1].replace(/<[^>]+>/g, '')),
  );
  return spoken.join(' ').replace(/\s+/g, ' ').trim();
}

export function pickTeluguTrack(tracks: CaptionTrack[]): CaptionTrack | null {
  const exact = tracks.find(
    (track) => track.languageCode.toLowerCase() === 'te',
  );
  if (exact) return exact;
  return (
    tracks.find((track) => track.languageCode.toLowerCase().startsWith('te')) ||
    null
  );
}
