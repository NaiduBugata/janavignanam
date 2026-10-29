import { validateConstituency } from '../../pipeline/native/constituency';
import {
  YOUTUBE_SEARCH_KEYWORDS,
  youtubeApiKey,
  youtubeMaxContentChars,
  youtubeMaxNewPerRun,
  youtubeMinContentChars,
  youtubeSearchPeriodDays,
} from './youtube.constants';
import type {
  YoutubeArticle,
  YoutubeCollectorEnvelope,
  YoutubeVideo,
} from './youtube.models';
import { normalizeYoutubeVideo } from './youtube.normalizer';
import { cleanTranscript, toRfc3339 } from './youtube.parser';
import { searchYoutubeKeyword } from './youtube.search';
import { fetchTeluguTranscriptResult } from './youtube.transcript';
import { isReligionStory } from '../../pipeline/native/religion';

export interface YoutubeCollection {
  envelope: YoutubeCollectorEnvelope;
  videosFound: number;
  nonNews: number;
  constituencyRejected: number;
  /** Videos YouTube served normally but without usable Telugu captions. Not an error. */
  noCaptions: number;
  /** Videos whose captions YouTube refused to this server, keyed by reason. */
  blocked: Record<string, number>;
  /** Videos YouTube answered normally (kept or rejected); blocked videos are left out so they are retried. */
  checkedVideoIds: string[];
  errors: string[];
  error?: string;
}

export interface CollectYoutubeOptions {
  fetchImpl?: typeof fetch;
  existingVideoIds?: Set<string>;
  now?: Date;
  maxNew?: number;
}

/**
 * Search constituency keywords, keep Telugu news transcripts that score as
 * the Narasaraopet parliamentary constituency. Does not read or write MongoDB.
 */
export async function collectYoutubeNews(
  options: CollectYoutubeOptions = {},
): Promise<YoutubeCollection> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? new Date();
  const existing = options.existingVideoIds ?? new Set<string>();
  const maxNew = options.maxNew ?? youtubeMaxNewPerRun();
  const minChars = youtubeMinContentChars();
  const maxChars = youtubeMaxContentChars();
  const lookback = youtubeSearchPeriodDays();
  const publishedAfter = toRfc3339(
    new Date(now.getTime() - lookback * 86400000),
  );
  const publishedBefore = toRfc3339(now);
  const errors: string[] = [];
  const seen = new Set<string>();
  const videos: YoutubeVideo[] = [];
  const blocked: Record<string, number> = {};
  const checkedVideoIds: string[] = [];
  let noCaptions = 0;

  const finish = (
    articles: YoutubeArticle[],
    nonNews: number,
    constituencyRejected: number,
    error?: string,
  ): YoutubeCollection => ({
    videosFound: videos.length,
    nonNews,
    constituencyRejected,
    noCaptions,
    blocked,
    checkedVideoIds,
    errors,
    error,
    envelope: {
      source: 'youtube',
      fetched_at: now.toISOString(),
      lookback_days: lookback,
      articles,
    },
  });

  if (!youtubeApiKey()) return finish([], 0, 0, 'youtube_missing_api_key');

  for (const keyword of YOUTUBE_SEARCH_KEYWORDS) {
    if (videos.length >= maxNew) break;
    let found;
    try {
      found = await searchYoutubeKeyword(
        keyword,
        publishedAfter,
        publishedBefore,
        fetchImpl,
      );
    } catch {
      errors.push('youtube_search_failed');
      continue;
    }
    if (found.error) {
      errors.push(found.error);
      continue;
    }
    for (const video of found.videos) {
      if (seen.has(video.video_id) || existing.has(video.video_id)) continue;
      seen.add(video.video_id);
      videos.push(video);
      if (videos.length >= maxNew) break;
    }
  }

  const articles: YoutubeArticle[] = [];
  let nonNews = 0;
  let constituencyRejected = 0;
  let captionRefusals = 0;
  for (const video of videos) {
    if (articles.length >= maxNew) break;
    if (captionRefusals >= 3) break;
    if (isReligionStory(video.title)) {
      nonNews += 1;
      checkedVideoIds.push(video.video_id);
      continue;
    }
    const result = await fetchTeluguTranscriptResult(video.video_id, fetchImpl);
    if (
      result.reason.startsWith('caption_http_429') ||
      result.reason.startsWith('player_http_429')
    )
      captionRefusals += 1;
    else captionRefusals = 0;
    const transcript = result.text;
    if (!transcript) {
      if (result.reason === 'no_captions') {
        noCaptions += 1;
        checkedVideoIds.push(video.video_id);
      } else blocked[result.reason] = (blocked[result.reason] || 0) + 1;
      continue;
    }
    checkedVideoIds.push(video.video_id);
    if (transcript.length < minChars) {
      noCaptions += 1;
      continue;
    }
    const cleaned = cleanTranscript(transcript, video.title, video.channel);
    if (!cleaned.is_news || cleaned.clean_text.length < minChars) {
      nonNews += 1;
      continue;
    }
    const content = cleaned.clean_text.slice(0, maxChars);
    const score = await validateConstituency(
      { title: video.title, content },
      fetchImpl,
    );
    if (!score.valid) {
      constituencyRejected += 1;
      continue;
    }
    const article = normalizeYoutubeVideo({ ...video, transcript }, content);
    article.constituency_score = score.score;
    article.constituency_match_reason = score.reason;
    article.assembly_segment = score.segment;
    articles.push(article);
  }

  // A few videos lack captions; every one of four or more lacking them means YouTube is hiding tracks from this server.
  if (videos.length >= 4 && noCaptions === videos.length) {
    blocked.no_captions_on_every_video = noCaptions;
    noCaptions = 0;
    checkedVideoIds.length = 0;
  }
  const blockedCount = Object.values(blocked).reduce(
    (sum, count) => sum + count,
    0,
  );
  if (blockedCount) {
    const reasons = Object.entries(blocked)
      .map(([reason, count]) => `${reason}=${count}`)
      .join(',');
    errors.push(`youtube_blocked:${blockedCount}/${videos.length}(${reasons})`);
  }
  return finish(articles, nonNews, constituencyRejected);
}
