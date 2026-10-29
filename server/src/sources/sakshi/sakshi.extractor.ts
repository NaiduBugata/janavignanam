import { load } from 'cheerio';
import {
  sakshiBodySelector,
  sakshiNoiseSelector,
  sakshiTitleSelector,
} from './sakshi.constants';
import type { SakshiRawArticle } from './sakshi.models';
import { collapseText, parseSakshiDatetime } from './sakshi.parser';

function metaContent(html: ReturnType<typeof load>, ...keys: string[]): string {
  for (const key of keys) {
    const content =
      html(`meta[property="${key}"]`).attr('content') ||
      html(`meta[name="${key}"]`).attr('content');
    if (content && content.trim()) return content.trim();
  }
  return '';
}

function fallbackParagraphs(html: string): string[] {
  const stripped = load(html);
  stripped(sakshiNoiseSelector()).remove();
  const paragraphs: string[] = [];
  stripped('p').each((_, element) => {
    const text = collapseText(stripped(element).text());
    if (text.length > 40) paragraphs.push(text);
  });
  return paragraphs;
}

/** Port of sources/sakshi/extractor.py::extract_article. */
export function extractSakshiArticle(
  html: string,
  url: string,
): SakshiRawArticle | null {
  const page = load(html);
  let title = collapseText(page(sakshiTitleSelector()).first().text());
  if (!title)
    title =
      metaContent(page, 'og:title') ||
      collapseText(page('title').first().text());

  const bodyNode = page(sakshiBodySelector()).first();
  let paragraphs: string[] = [];
  if (bodyNode.length) {
    bodyNode.find('p').each((_, element) => {
      const text = collapseText(page(element).text());
      if (text) paragraphs.push(text);
    });
  }
  if (!paragraphs.length) paragraphs = fallbackParagraphs(html);

  const content = paragraphs.join('\n\n').trim();
  if (!title || content.length < 80) return null;

  let published =
    parseSakshiDatetime(
      metaContent(page, 'article:published_time', 'publish-date', 'date'),
    ) || parseSakshiDatetime(metaContent(page, 'og:updated_time'));
  if (!published) {
    const timeTag = page('time').first();
    published = parseSakshiDatetime(timeTag.attr('datetime') || timeTag.text());
  }

  const canonical = (page('link[rel="canonical"]').attr('href') || '').trim();
  const breadcrumbs: string[] = [];
  page('nav.breadcrumb li, .breadcrumb li, ol.breadcrumb li').each(
    (_, element) => {
      const text = collapseText(page(element).text());
      if (text) breadcrumbs.push(text);
    },
  );
  const tags: string[] = [];
  page("a[rel='tag'], .tags a, .story-tags a").each((_, element) => {
    const text = collapseText(page(element).text());
    if (text) tags.push(text);
  });

  const author =
    metaContent(page, 'article:author', 'author') ||
    collapseText(page('.author, .byline, span.author-name').first().text());
  const category =
    metaContent(page, 'article:section') ||
    (breadcrumbs.length >= 2 ? breadcrumbs[breadcrumbs.length - 2] : '');
  const summary = metaContent(page, 'og:description', 'description');
  const thumbnail = metaContent(page, 'og:image');

  return {
    url: canonical || url,
    title,
    content,
    summary,
    author,
    category,
    tags,
    breadcrumb: breadcrumbs,
    thumbnail,
    description: summary,
    published_at: published,
    og_description: summary,
  };
}
