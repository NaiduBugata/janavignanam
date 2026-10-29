import {
  youtubeApiKey,
  youtubeMaxResultsPerKeyword,
} from './youtube.constants';
import type { YoutubeVideo } from './youtube.models';

export function buildYoutubeSearchUrl(
  keyword: string,
  publishedAfter: string,
  publishedBefore: string,
  apiKey: string,
  maxResults: number,
): string {
  const params = new URLSearchParams({
    q: keyword,
    part: 'snippet',
    maxResults: String(maxResults),
    type: 'video',
    publishedAfter,
    publishedBefore,
    order: 'date',
    key: apiKey,
  });
  return `https://www.googleapis.com/youtube/v3/search?${params.toString()}`;
}

export function parseSearchItems(body: {
  items?: Array<Record<string, unknown>>;
}): YoutubeVideo[] {
  const videos: YoutubeVideo[] = [];
  for (const item of body.items || []) {
    const id = item.id as { videoId?: string } | undefined;
    const snippet = item.snippet as Record<string, unknown> | undefined;
    const videoId = id?.videoId;
    if (!videoId || !snippet) continue;
    videos.push({
      video_id: videoId,
      title: String(snippet.title || ''),
      channel: String(snippet.channelTitle || ''),
      published_at: String(snippet.publishedAt || ''),
      url: `https://www.youtube.com/watch?v=${videoId}`,
    });
  }
  return videos;
}

export async function searchYoutubeKeyword(
  keyword: string,
  publishedAfter: string,
  publishedBefore: string,
  fetchImpl: typeof fetch,
): Promise<{ videos: YoutubeVideo[]; error?: string }> {
  const url = buildYoutubeSearchUrl(
    keyword,
    publishedAfter,
    publishedBefore,
    youtubeApiKey(),
    youtubeMaxResultsPerKeyword(),
  );
  let response = await fetchImpl(url);
  if (response.status === 429 || response.status === 503) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    response = await fetchImpl(url);
  }
  if (!response.ok)
    return { videos: [], error: `youtube_http_${response.status}` };
  const body = (await response.json()) as {
    items?: Array<Record<string, unknown>>;
  };
  return { videos: parseSearchItems(body) };
}
