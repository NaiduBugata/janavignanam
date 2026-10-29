import { collectYoutubeNews } from './youtube.collector';
import { cleanTranscript } from './youtube.parser';
import { normalizeYoutubeVideo } from './youtube.normalizer';
import { buildYoutubeSearchUrl } from './youtube.search';

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  } as Response;
}

describe('youtube transcript cleaner', () => {
  it('keeps a news channel and strips filler', () => {
    const result = cleanTranscript(
      'వార్తలు వివరాలు subscribe like and share',
      'News bulletin',
      'TV9',
    );
    expect(result.is_news).toBe(true);
    expect(result.clean_text.toLowerCase()).not.toContain('subscribe');
  });

  it('drops a trailer', () => {
    const result = cleanTranscript(
      'some transcript text',
      'New movie trailer reaction',
      'Random Channel',
    );
    expect(result.is_news).toBe(false);
    expect(result.clean_text).toBe('');
  });

  it('keeps a transcript that contains a news indicator', () => {
    const result = cleanTranscript(
      'పోలీస్ అరెస్ట్ ఘటన వివరాలు',
      'Village report',
      'Some Channel',
    );
    expect(result.is_news).toBe(true);
  });

  it('drops a worship video even from a news channel', () => {
    const result = cleanTranscript(
      'ఆరాధన కార్యక్రమం వివరాలు',
      'ఆదివారం ఆరాధన నరసరావుపేట',
      'TV9',
    );
    expect(result.is_news).toBe(false);
  });
});

describe('youtube search url', () => {
  it('searches videos in a date window', () => {
    const url = buildYoutubeSearchUrl(
      'నరసరావుపేట',
      '2026-07-08T00:00:00Z',
      '2026-07-10T00:00:00Z',
      'key',
      50,
    );
    expect(url).toContain('type=video');
    expect(url).toContain('order=date');
    expect(url).toContain('publishedAfter=');
    expect(url).toContain('publishedBefore=');
    expect(decodeURIComponent(url)).toContain('నరసరావుపేట');
  });
});

describe('normalizeYoutubeVideo', () => {
  it('maps a transcript item', () => {
    const article = normalizeYoutubeVideo(
      {
        video_id: 'abc123',
        title: 'T',
        channel: 'TV9',
        url: 'https://www.youtube.com/watch?v=abc123',
        published_at: '2026-07-10T08:30:00Z',
        transcript: 'raw',
      },
      'clean text',
    );
    expect(article.id).toBe('abc123');
    expect(article.content).toBe('clean text');
    expect(article.created_on).toBe('2026-07-10T08:30:00Z');
    expect(article.channel).toBe('TV9');
  });
});

describe('collectYoutubeNews', () => {
  const originalKey = process.env.YOUTUBE_API_KEY;

  afterEach(() => {
    if (originalKey == null) delete process.env.YOUTUBE_API_KEY;
    else process.env.YOUTUBE_API_KEY = originalKey;
  });

  it('requires an API key and does not call the network', async () => {
    delete process.env.YOUTUBE_API_KEY;
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return jsonResponse({});
    }) as typeof fetch;
    const collected = await collectYoutubeNews({ fetchImpl });
    expect(collected.error).toBe('youtube_missing_api_key');
    expect(calls).toBe(0);
  });

  it('keeps Narasaraopet news and drops district-only and non-news videos', async () => {
    process.env.YOUTUBE_API_KEY = 'yt-test';
    const localNews = 'నరసరావుపేటలో పోలీస్ అరెస్ట్ ఘటన వివరాలు. '.repeat(6);
    const districtOnly = 'పల్నాడు జిల్లా వాతావరణ నివేదిక. '.repeat(8);
    const trailer = 'unrelated cinema talk. '.repeat(12);
    const fetchImpl = (async (url: string) => {
      const target = String(url);
      if (target.includes('googleapis.com')) {
        const query = decodeURIComponent(target);
        if (!query.includes('నరసరావుపేట') && !query.includes('Narasaraopet')) {
          return jsonResponse({ items: [] });
        }
        return jsonResponse({
          items: [
            {
              id: { videoId: 'local1' },
              snippet: {
                title: 'నరసరావుపేట వార్త',
                channelTitle: 'TV9 Telugu',
                publishedAt: '2026-07-10T08:30:00Z',
              },
            },
            {
              id: { videoId: 'district1' },
              snippet: {
                title: 'పల్నాడు వాతావరణం',
                channelTitle: 'TV9 Telugu',
                publishedAt: '2026-07-10T09:00:00Z',
              },
            },
            {
              id: { videoId: 'trailer1' },
              snippet: {
                title: 'Narasaraopet movie trailer',
                channelTitle: 'Random Channel',
                publishedAt: '2026-07-10T10:00:00Z',
              },
            },
          ],
        });
      }
      if (target.includes('watch?v=local1')) {
        return jsonResponse(
          `"captionTracks":[{"baseUrl":"https://captions.test/local1","languageCode":"te"}]`,
        );
      }
      if (target.includes('watch?v=district1')) {
        return jsonResponse(
          `"captionTracks":[{"baseUrl":"https://captions.test/district1","languageCode":"te"}]`,
        );
      }
      if (target.includes('watch?v=trailer1')) {
        return jsonResponse(
          `"captionTracks":[{"baseUrl":"https://captions.test/trailer1","languageCode":"te"}]`,
        );
      }
      if (target.includes('captions.test/local1'))
        return jsonResponse(`<text>${localNews}</text>`);
      if (target.includes('captions.test/district1'))
        return jsonResponse(`<text>${districtOnly}</text>`);
      if (target.includes('captions.test/trailer1'))
        return jsonResponse(`<text>${trailer}</text>`);
      return jsonResponse({}, 404);
    }) as typeof fetch;

    const collected = await collectYoutubeNews({
      fetchImpl,
      now: new Date('2026-07-10T12:00:00Z'),
      maxNew: 10,
    });

    expect(
      collected.envelope.articles.map((article) => article.video_id),
    ).toEqual(['local1']);
    expect(collected.envelope.articles[0].id).toBe('local1');
    expect(
      collected.envelope.articles[0].constituency_score,
    ).toBeGreaterThanOrEqual(6);
    expect(collected.constituencyRejected).toBe(1);
    expect(collected.nonNews).toBe(1);
    expect(collected.envelope.lookback_days).toBe(2);
  });

  function searchWith(ids: string[], player: (id: string) => Response) {
    return (async (url: string, init?: RequestInit) => {
      const target = String(url);
      if (target.includes('googleapis.com')) {
        return jsonResponse({
          items: ids.map((id) => ({
            id: { videoId: id },
            snippet: {
              title: 'నరసరావుపేట వార్త',
              channelTitle: 'TV9 Telugu',
              publishedAt: '2026-07-10T08:30:00Z',
            },
          })),
        });
      }
      if (target.includes('youtubei/v1/player')) {
        const body = JSON.parse(String(init?.body || '{}')) as {
          videoId: string;
        };
        return player(body.videoId);
      }
      return jsonResponse({}, 404);
    }) as typeof fetch;
  }

  it('reports one youtube_blocked error when YouTube refuses the server', async () => {
    process.env.YOUTUBE_API_KEY = 'yt-test';
    const collected = await collectYoutubeNews({
      fetchImpl: searchWith(['a1', 'a2'], () =>
        jsonResponse({ playabilityStatus: { status: 'LOGIN_REQUIRED' } }),
      ),
      now: new Date('2026-07-10T12:00:00Z'),
      maxNew: 10,
    });
    expect(collected.errors).toEqual([
      'youtube_blocked:2/2(playability_login_required=2)',
    ]);
    expect(collected.noCaptions).toBe(0);
  });

  it('uses the Android player when the web player asks for a login', async () => {
    process.env.YOUTUBE_API_KEY = 'yt-test';
    const localNews = 'నరసరావుపేటలో పోలీస్ అరెస్ట్ ఘటన వివరాలు. '.repeat(6);
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      const target = String(url);
      if (target.includes('googleapis.com')) {
        return jsonResponse({
          items: [
            {
              id: { videoId: 'local1' },
              snippet: {
                title: 'నరసరావుపేట వార్త',
                channelTitle: 'TV9 Telugu',
                publishedAt: '2026-07-10T08:30:00Z',
              },
            },
          ],
        });
      }
      if (target.includes('youtubei/v1/player')) {
        const body = JSON.parse(String(init?.body || '{}')) as {
          context?: { client?: { clientName?: string } };
        };
        if (body.context?.client?.clientName === 'ANDROID') {
          return jsonResponse({
            playabilityStatus: { status: 'OK' },
            captions: {
              playerCaptionsTracklistRenderer: {
                captionTracks: [
                  {
                    baseUrl: 'https://captions.test/local1',
                    languageCode: 'te',
                  },
                ],
              },
            },
          });
        }
        return jsonResponse({
          playabilityStatus: { status: 'LOGIN_REQUIRED' },
        });
      }
      if (target.includes('captions.test/local1'))
        return jsonResponse(`<text>${localNews}</text>`);
      return jsonResponse({}, 404);
    }) as typeof fetch;
    const collected = await collectYoutubeNews({
      fetchImpl,
      now: new Date('2026-07-10T12:00:00Z'),
      maxNew: 5,
    });
    expect(collected.errors).toEqual([]);
    expect(
      collected.envelope.articles.map((article) => article.video_id),
    ).toEqual(['local1']);
  });

  it('skips videos without Telugu captions without calling it an error', async () => {
    process.env.YOUTUBE_API_KEY = 'yt-test';
    const collected = await collectYoutubeNews({
      fetchImpl: searchWith(['b1', 'b2'], () =>
        jsonResponse({ playabilityStatus: { status: 'OK' }, captions: {} }),
      ),
      now: new Date('2026-07-10T12:00:00Z'),
      maxNew: 10,
    });
    expect(collected.errors).toEqual([]);
    expect(collected.noCaptions).toBe(2);
  });

  it('treats missing captions on every one of many videos as a block', async () => {
    process.env.YOUTUBE_API_KEY = 'yt-test';
    const collected = await collectYoutubeNews({
      fetchImpl: searchWith(['c1', 'c2', 'c3', 'c4'], () =>
        jsonResponse({ playabilityStatus: { status: 'OK' }, captions: {} }),
      ),
      now: new Date('2026-07-10T12:00:00Z'),
      maxNew: 10,
    });
    expect(collected.errors).toEqual([
      'youtube_blocked:4/4(no_captions_on_every_video=4)',
    ]);
  });
});
