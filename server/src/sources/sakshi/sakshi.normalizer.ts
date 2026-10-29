import type { SakshiArticle, SakshiRawArticle } from './sakshi.models';
import { stableArticleId } from './sakshi.parser';

/** Port of sources/sakshi/normalizer.py::normalize_sakshi_article. */
export function normalizeSakshiArticle(
  raw: SakshiRawArticle,
  now: Date = new Date(),
): SakshiArticle {
  const url = (raw.url || '').trim();
  const content = (raw.content || '').trim();
  const published = raw.published_at || now.toISOString();
  const validation = raw._constituency_validation;
  return {
    id: stableArticleId(url),
    source: 'sakshi',
    source_type: 'newspaper',
    title: (raw.title || '').trim(),
    content,
    article: content,
    summary: raw.summary || '',
    published_at: published,
    created_on: published,
    author: raw.author || '',
    category: raw.category || '',
    subcategory: '',
    tags: raw.tags || [],
    keywords: [],
    entities: [],
    location: {},
    thumbnail: raw.thumbnail || '',
    description: raw.description || '',
    source_url: url,
    url,
    language: 'te',
    channel: 'Sakshi',
    constituency_score: validation?.score ?? null,
    constituency_match_reason: validation?.reason ?? null,
    assembly_segment: validation?.segment ?? null,
  };
}
