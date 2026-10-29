import { LOKAL_WEBSITE_BASE_URL } from './lokal.constants';
import type { LokalArticle } from './lokal.models';
import { parsePostDate } from './lokal.parser';

export function buildArticleUrl(post: Record<string, unknown>): string {
  const customLink = post.custom_link;
  if (customLink) return String(customLink);
  const slug = String(post.slug || '').trim();
  const postId = post.id;
  if (slug && postId != null)
    return `${LOKAL_WEBSITE_BASE_URL}/${slug}-${postId}`;
  if (postId != null) return `${LOKAL_WEBSITE_BASE_URL}/post/${postId}`;
  return '';
}

export function normalizeArticle(post: unknown): LokalArticle | null {
  if (!post || typeof post !== 'object' || Array.isArray(post)) return null;
  const row = post as Record<string, unknown>;
  if (row.id == null) return null;
  if (row.created_on == null) return null;
  return {
    id: row.id as string | number,
    title: String(row.title || ''),
    content: String(row.content || ''),
    created_on: String(row.created_on),
    url: buildArticleUrl(row),
    raw: row,
  };
}

/** Keep the newest created_on for each id. Returns [articles, duplicatesRemoved]. */
export function removeDuplicates(
  articles: LokalArticle[],
): [LokalArticle[], number] {
  const newest = new Map<string, LokalArticle>();
  for (const article of articles) {
    const key = String(article.id);
    const existing = newest.get(key);
    if (!existing) {
      newest.set(key, article);
      continue;
    }
    const existingDt = parsePostDate(existing.created_on);
    const currentDt = parsePostDate(article.created_on);
    if (
      currentDt &&
      (!existingDt || currentDt.getTime() >= existingDt.getTime())
    ) {
      newest.set(key, article);
    }
  }
  const deduped = [...newest.values()];
  return [deduped, articles.length - deduped.length];
}
