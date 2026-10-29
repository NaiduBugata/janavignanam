import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { extractSakshiArticle } from './sakshi.extractor';
import { PermanentHttpError, fetchSakshiHtml } from './sakshi.http';
import { collectSakshiNews, rankSakshiLinks } from './sakshi.collector';
import { isArticleUrl } from './sakshi.parser';
import { normalizeSakshiArticle } from './sakshi.normalizer';

const FIXTURES = resolve(__dirname, 'fixtures');

function htmlResponse(body: string, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
    json: async () => ({}),
  } as Response;
}

describe('sakshi link ranking', () => {
  const tagPage = readFileSync(resolve(FIXTURES, 'tag_page.html'), 'utf8');

  it('keeps only Narasaraopet place-name article links', () => {
    const links = rankSakshiLinks(tagPage);
    expect(links).toHaveLength(2);
    expect(links.some((url) => url.includes('narasaraopet-road-works'))).toBe(
      true,
    );
    expect(
      links.some((url) => url.includes('local-school-reopens-narasaraopet')),
    ).toBe(true);
    expect(links.some((url) => url.includes('iran-alert'))).toBe(false);
    expect(links.some((url) => url.includes('/videos/'))).toBe(false);
    expect(links.some((url) => url.includes('example.com'))).toBe(false);
  });

  it('accepts news article URLs and rejects videos and tag pages', () => {
    expect(
      isArticleUrl(
        'https://www.sakshi.com/news/andhra-pradesh/some-long-story-slug-here',
      ),
    ).toBe(true);
    expect(isArticleUrl('https://www.sakshi.com/videos/clip')).toBe(false);
    expect(isArticleUrl('https://www.sakshi.com/tags/narasaraopet')).toBe(
      false,
    );
  });
});

describe('sakshi article extract', () => {
  it('normalizes a constituency article', () => {
    const html = readFileSync(resolve(FIXTURES, 'article_page.html'), 'utf8');
    const url =
      'https://www.sakshi.com/news/andhra-pradesh/narasaraopet-road-works-12345';
    const raw = extractSakshiArticle(html, url);
    expect(raw).not.toBeNull();
    expect(raw?.title).toContain('రోడ్డు');
    expect(raw?.content).toContain('రోడ్డు పనులు');
    expect(raw?.published_at).toBeTruthy();
    const normalized = normalizeSakshiArticle(raw!);
    expect(normalized.source).toBe('sakshi');
    expect(normalized.source_type).toBe('newspaper');
    expect(normalized.language).toBe('te');
    expect(normalized.channel).toBe('Sakshi');
    expect(normalized.source_url).toBe(url);
    expect(normalized.id).toBeTruthy();
    expect(normalized.content).toBe(normalized.article);
    expect(normalized.created_on).toBe(normalized.published_at);
  });
});

describe('collectSakshiNews', () => {
  const tagPage = readFileSync(resolve(FIXTURES, 'tag_page.html'), 'utf8');
  const articlePage = readFileSync(
    resolve(FIXTURES, 'article_page.html'),
    'utf8',
  );

  it('downloads constituency links and drops a story that is not about Narasaraopet', async () => {
    const fetched: string[] = [];
    const fetchImpl = (async (url: string) => {
      fetched.push(String(url));
      if (String(url).includes('/tags/narasaraopet'))
        return htmlResponse(tagPage);
      if (String(url).includes('local-school-reopens')) {
        return htmlResponse(
          '<h1>Mumbai cinema premiere</h1><div class="story-content"><p>' +
            'A national cinema item about Mumbai with no constituency place name in the body text at all.</p></div>',
        );
      }
      return htmlResponse(articlePage);
    }) as typeof fetch;

    const collected = await collectSakshiNews({
      fetchImpl,
      requestDelayMs: 0,
      retryDelayMs: 0,
      now: new Date('2026-07-10T12:00:00Z'),
    });

    expect(fetched.some((url) => url.includes('iran-alert'))).toBe(false);
    expect(collected.envelope.source).toBe(
      'https://www.sakshi.com/tags/narasaraopet',
    );
    expect(collected.envelope.articles.map((article) => article.title)).toEqual(
      ['నరసరావుపేట రోడ్డు పనులు'],
    );
    expect(collected.envelope.filter_stats.rejected).toBe(1);
    expect(collected.envelope.filter_stats.accepted).toBe(1);
    expect(
      collected.envelope.articles[0].constituency_score,
    ).toBeGreaterThanOrEqual(6);
    expect(collected.envelope.articles[0].assembly_segment).toBe(
      'Narasaraopet',
    );
  });

  it('reads every segment tag page, alternates their links, and survives one failed tag', async () => {
    const original = process.env.SAKSHI_TAG_URLS;
    process.env.SAKSHI_TAG_URLS =
      'https://www.sakshi.com/tags/macherla,https://www.sakshi.com/tags/vinukonda,https://www.sakshi.com/tags/gurazala';
    const tag = (slugs: string[]) =>
      slugs
        .map(
          (slug) =>
            `<a href="https://www.sakshi.com/news/andhra-pradesh/${slug}-1234567">${slug}</a>`,
        )
        .join('');
    const articles: string[] = [];
    const fetchImpl = (async (url: string) => {
      const target = String(url);
      if (target.endsWith('/tags/macherla'))
        return htmlResponse(tag(['macherla-road', 'macherla-water']));
      if (target.endsWith('/tags/vinukonda'))
        return htmlResponse(tag(['vinukonda-school']));
      if (target.endsWith('/tags/gurazala')) return htmlResponse('', 403);
      articles.push(target);
      const place = target.includes('vinukonda') ? 'Vinukonda' : 'Macherla';
      return htmlResponse(
        `<h1>${place} civic update</h1><div class="story-content"><p>${`${place} town residents report civic issues. `.repeat(5)}</p></div>`,
      );
    }) as typeof fetch;

    try {
      const collected = await collectSakshiNews({
        fetchImpl,
        requestDelayMs: 0,
        retryDelayMs: 0,
      });
      expect(collected.error).toBeUndefined();
      expect(
        articles.map((url) => url.replace(/.*\/(\w+-\w+)-\d+$/, '$1')),
      ).toEqual(['macherla-road', 'vinukonda-school', 'macherla-water']);
      expect(
        collected.envelope.articles.map((article) => article.assembly_segment),
      ).toEqual(['Macherla', 'Vinukonda', 'Macherla']);
    } finally {
      if (original === undefined) delete process.env.SAKSHI_TAG_URLS;
      else process.env.SAKSHI_TAG_URLS = original;
    }
  });

  it('saves the public feed when Sakshi refuses the tag page', async () => {
    const original = process.env.SAKSHI_TAG_URLS;
    process.env.SAKSHI_TAG_URLS = 'https://www.sakshi.com/tags/narasaraopet';
    const fetchImpl = (async (url: string) => {
      const target = String(url);
      if (target.includes('news.google.com')) {
        return htmlResponse(
          '<rss><channel><item><title>నరసరావుపేటలో రోడ్డు పనులు - sakshi.com</title>' +
            '<link>https://news.google.com/rss/articles/story1</link>' +
            '<pubDate>Sun, 04 Oct 2026 19:33:00 GMT</pubDate></item></channel></rss>',
        );
      }
      return htmlResponse('refused', 403);
    }) as typeof fetch;
    try {
      const collected = await collectSakshiNews({
        fetchImpl,
        requestDelayMs: 0,
        retryDelayMs: 0,
        now: new Date('2026-10-05T12:00:00Z'),
      });
      expect(collected.error).toBeUndefined();
      expect(collected.envelope.articles).toHaveLength(1);
      expect(collected.envelope.articles[0].title).toBe(
        'నరసరావుపేటలో రోడ్డు పనులు',
      );
      expect(collected.envelope.articles[0].assembly_segment).toBe(
        'Narasaraopet',
      );
      expect(collected.envelope.articles[0].source_url).toBe(
        'https://news.google.com/rss/articles/story1',
      );
    } finally {
      if (original === undefined) delete process.env.SAKSHI_TAG_URLS;
      else process.env.SAKSHI_TAG_URLS = original;
    }
  });
});

describe('sakshi http', () => {
  it('retries a transient status and then returns the page', async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      if (calls === 1) return htmlResponse('', 503);
      return htmlResponse('<html></html>', 200);
    }) as typeof fetch;
    const html = await fetchSakshiHtml(
      'https://www.sakshi.com/news/example-long-enough',
      fetchImpl,
      {
        retryDelayMs: 0,
      },
    );
    expect(html).toContain('html');
    expect(calls).toBe(2);
  });

  it('does not retry a 404', async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return htmlResponse('missing', 404);
    }) as typeof fetch;
    await expect(
      fetchSakshiHtml(
        'https://www.sakshi.com/news/missing-article-page',
        fetchImpl,
        {
          retryDelayMs: 0,
        },
      ),
    ).rejects.toBeInstanceOf(PermanentHttpError);
    expect(calls).toBe(1);
  });
});
