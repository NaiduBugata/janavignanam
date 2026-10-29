import type { YoutubeArticle, YoutubeTranscript } from './youtube.models';

/** Port of sources/youtube/normalizer.py::normalize_video. */
export function normalizeYoutubeVideo(
  item: YoutubeTranscript,
  cleanText: string,
): YoutubeArticle {
  return {
    id: item.video_id,
    video_id: item.video_id,
    title: item.title || '',
    content: cleanText,
    channel: item.channel || '',
    url: item.url || '',
    created_on: item.published_at || '',
  };
}
