import {
  buildArticleUrl,
  normalizeArticle,
  removeDuplicates,
} from './lokal.normalizer';
import { parsePostDate } from './lokal.parser';
import { buildLokalPageUrl } from './lokal.api';
import { collectLokalNews } from './lokal.collector';
import { fetchLokalWindow } from './lokal.extractor';

describe('lokal parser and normalizer', () => {
  it('parses Zulu and offset timestamps as UTC', () => {
    const zulu = parsePostDate('2026-07-10T08:30:00Z');
    expect(zulu?.getUTCHours()).toBe(8);
    const offset = parsePostDate('2026-07-10T08:30:00+05:30');
    expect(offset?.getUTCHours()).toBe(3);
    expect(parsePostDate(null)).toBeNull();
    expect(parsePostDate('')).toBeNull();
    expect(parsePostDate('not-a-date')).toBeNull();
  });

  it('builds page and article URLs the way Flask does', () => {
    expect(buildLokalPageUrl(3)).toContain('page=3');
    expect(buildLokalPageUrl(3)).toContain('tag_id=374');
    expect(
      buildArticleUrl({ custom_link: 'https://example.com/x', id: 5 }),
    ).toBe('https://example.com/x');
    expect(buildArticleUrl({ slug: 'my-story', id: 42 })).toMatch(
      /\/my-story-42$/,
    );
    expect(buildArticleUrl({ id: 42 })).toMatch(/\/post\/42$/);
  });

  it('normalizes a post and skips rows missing id or date', () => {
    const post = {
      id: 1,
      title: 'T',
      content: 'C',
      created_on: '2026-07-10T08:30:00Z',
    };
    const article = normalizeArticle(post);
    expect(article?.id).toBe(1);
    expect(article?.title).toBe('T');
    expect(article?.raw).toEqual(post);
    expect(
      normalizeArticle({ title: 'no id', created_on: '2026-07-10' }),
    ).toBeNull();
    expect(normalizeArticle({ id: 1, title: 'no date' })).toBeNull();
  });

  it('keeps the newest article for a repeated id', () => {
    const older = normalizeArticle({
      id: 1,
      title: 'old',
      created_on: '2026-07-09T00:00:00Z',
    });
    const newer = normalizeArticle({
      id: 1,
      title: 'new',
      created_on: '2026-07-10T00:00:00Z',
    });
    const unique = normalizeArticle({
      id: 2,
      title: 'other',
      created_on: '2026-07-10T00:00:00Z',
    });
    const [deduped, removed] = removeDuplicates([older!, newer!, unique!]);
    expect(removed).toBe(1);
    expect(deduped).toHaveLength(2);
    expect(deduped.find((a) => a.id === 1)?.title).toBe('new');
  });
});

describe('lokal extractor and collector', () => {
  it('stops at the lookback cutoff and when next is absent', async () => {
    const now = new Date('2026-07-10T12:00:00Z');
    const fetchImpl = (async (url: string) => {
      const page = new URL(String(url)).searchParams.get('page');
      if (page === '1') {
        return {
          status: 200,
          json: async () => ({
            next: 'page2',
            results: [
              {
                id: 9,
                title: 'నరసరావుపేట వార్త',
                content: 'పల్నాడు',
                created_on: '2026-07-10T08:00:00Z',
              },
              {
                id: 8,
                title: 'old',
                content: 'old',
                created_on: '2026-06-01T00:00:00Z',
              },
            ],
          }),
        } as Response;
      }
      throw new Error('should not fetch past cutoff');
    }) as typeof fetch;

    const window = await fetchLokalWindow(fetchImpl, now);
    expect(window.articles.map((a) => a.id)).toEqual([9]);
    expect(window.skipped).toBe(0);
  });

  it('drops articles that fail the constituency dictionary', async () => {
    const now = new Date('2026-07-10T12:00:00Z');
    const fetchImpl = (async () =>
      ({
        status: 200,
        json: async () => ({
          next: null,
          results: [
            {
              id: 1,
              title: 'నరసరావుపేట రోడ్డు',
              content: 'పనులు',
              created_on: '2026-07-10T08:00:00Z',
            },
            {
              id: 2,
              title: 'Mumbai cinema premiere',
              content: 'unrelated national item',
              created_on: '2026-07-10T08:00:00Z',
            },
          ],
        }),
      }) as Response) as typeof fetch;

    const collected = await collectLokalNews(fetchImpl, now);
    expect(collected.envelope.articles.map((a) => a.id)).toEqual([1]);
    expect(collected.constituencyRejected).toBe(1);
    expect(collected.envelope.collector).toBe('Lokal News Collector');
    expect(collected.envelope.tag_id).toBe(374);
    expect(collected.envelope.lookback_hours).toBe(168);
  });
});
