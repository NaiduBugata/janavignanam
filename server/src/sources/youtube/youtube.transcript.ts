import { YOUTUBE_TRANSCRIPT_LANGUAGES } from './youtube.constants';
import {
  extractCaptionTracks,
  parseCaptionText,
  pickTeluguTrack,
} from './youtube.parser';

const BROWSER =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

function watchHeaders(videoId: string): Record<string, string> {
  return {
    'User-Agent': BROWSER,
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'te-IN,te;q=0.9,en;q=0.8',
    Referer: `https://www.youtube.com/watch?v=${videoId}`,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface TranscriptResult {
  text: string | null;
  /** `ok`, `no_captions` when YouTube answered normally without a Telugu track, otherwise why YouTube refused. */
  reason: string;
}

async function fetchCaption(
  url: string,
  videoId: string,
  fetchImpl: typeof fetch,
): Promise<TranscriptResult> {
  const target = url.includes('fmt=')
    ? url
    : `${url}${url.includes('?') ? '&' : '?'}fmt=json3`;
  let response = await fetchImpl(target, { headers: watchHeaders(videoId) });
  if (response.status === 429) {
    await sleep(400);
    response = await fetchImpl(target, { headers: watchHeaders(videoId) });
  }
  if (!response.ok)
    return { text: null, reason: `caption_http_${response.status}` };
  const text = parseCaptionText(await response.text());
  return text
    ? { text, reason: 'ok' }
    : { text: null, reason: 'caption_empty' };
}

async function fetchInnertubeTranscript(
  videoId: string,
  clientName: 'WEB' | 'ANDROID',
  fetchImpl: typeof fetch,
): Promise<TranscriptResult> {
  const client =
    clientName === 'WEB'
      ? { clientName: 'WEB', clientVersion: '2.20251002.00.00', hl: 'te' }
      : { clientName: 'ANDROID', clientVersion: '20.10.38', hl: 'te' };
  const response = await fetchImpl(
    'https://www.youtube.com/youtubei/v1/player?prettyPrint=false',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent':
          clientName === 'WEB'
            ? BROWSER
            : 'com.google.android.youtube/20.10.38 (Linux; U; Android 14)',
      },
      body: JSON.stringify({ context: { client }, videoId }),
    },
  );
  if (!response.ok)
    return { text: null, reason: `player_http_${response.status}` };
  const payload = (await response.json()) as {
    playabilityStatus?: { status?: string };
    captions?: {
      playerCaptionsTracklistRenderer?: {
        captionTracks?: Array<{ baseUrl?: string; languageCode?: string }>;
      };
    };
  };
  const playability = payload.playabilityStatus?.status || 'UNKNOWN';
  if (playability !== 'OK')
    return { text: null, reason: `playability_${playability.toLowerCase()}` };
  const tracks =
    payload.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
  const track = pickTeluguTrack(
    tracks
      .filter((row) => row.baseUrl)
      .map((row) => ({
        baseUrl: String(row.baseUrl),
        languageCode: String(row.languageCode || ''),
      })),
  );
  if (!track) return { text: null, reason: 'no_captions' };
  return fetchCaption(track.baseUrl, videoId, fetchImpl);
}

/**
 * Telugu captions only, matching youtube_transcript_api languages=['te'].
 * The player endpoint returns a usable caption URL. Watch-page tracks and
 * timedtext are fallbacks when that URL is empty.
 */
export async function fetchTeluguTranscriptResult(
  videoId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<TranscriptResult> {
  const language = YOUTUBE_TRANSCRIPT_LANGUAGES[0];
  let primary: TranscriptResult = { text: null, reason: 'player_failed' };
  try {
    // The web player answers LOGIN_REQUIRED from this server. The Android player still returns tracks.
    for (const client of ['ANDROID', 'WEB'] as const) {
      const result = await fetchInnertubeTranscript(videoId, client, fetchImpl);
      if (result.text || result.reason === 'no_captions') return result;
      if (
        primary.reason === 'player_failed' ||
        result.reason !== 'playability_login_required'
      )
        primary = result;
    }
  } catch {
    // Watch-page captions are the fallback.
  }
  try {
    const watch = await fetchImpl(
      `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`,
      {
        headers: watchHeaders(videoId),
      },
    );
    if (watch.ok) {
      const track = pickTeluguTrack(extractCaptionTracks(await watch.text()));
      if (track) {
        const caption = await fetchCaption(track.baseUrl, videoId, fetchImpl);
        if (caption.text) return caption;
      }
    }
  } catch {
    // Timedtext below is the fallback.
  }
  try {
    const timed = await fetchCaption(
      `https://www.youtube.com/api/timedtext?v=${encodeURIComponent(videoId)}&lang=${language}`,
      videoId,
      fetchImpl,
    );
    if (timed.text) return timed;
  } catch {
    // The primary reason is reported.
  }
  return primary;
}

export async function fetchTeluguTranscript(
  videoId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  return (await fetchTeluguTranscriptResult(videoId, fetchImpl)).text;
}
