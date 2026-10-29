import {
  CombinedPipelineService,
  decide,
  resolveSegment,
} from './combined-pipeline.service';
import { problemId } from './problem-id';
import { repairJson } from './json-repair';
import { DatabaseService } from '../../database/database.service';

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

describe('problem id and json repair', () => {
  it('is stable for the same semantic fields', () => {
    expect(problemId('roads', 'palnadu', 'potholes')).toBe(
      problemId('roads', 'palnadu', 'potholes'),
    );
  });

  it('repairs fenced JSON', () => {
    expect(repairJson('```json\n{"summary":"ok"}\n```')).toEqual({
      summary: 'ok',
    });
  });

  it('rejects critical validation', () => {
    expect(decide([{ severity: 'CRITICAL' }], 1)).toBe('reject');
    expect(decide([{ severity: 'ERROR', repaired: false }], 1)).toBe('retry');
    expect(decide([], 0)).toBe('accept');
  });
});

describe('segment gate', () => {
  const base = {
    source: 'lokal',
    post_id: '1',
    created_on: '',
    source_url: '',
  };

  it('keeps an article already mapped to one of the seven segments', () => {
    expect(
      resolveSegment({
        ...base,
        title: 'x',
        content: 'y',
        assembly_segment: 'Vinukonda',
      } as never),
    ).toBe('Vinukonda');
  });

  it('maps an unlabelled article from its text and rejects unknown labels', () => {
    expect(
      resolveSegment({
        ...base,
        title: 'Macherla bus stand',
        content: 'repairs',
      } as never),
    ).toBe('Macherla');
    expect(
      resolveSegment({
        ...base,
        title: 'Guntur bus stand',
        content: 'repairs',
        assembly_segment: 'Guntur',
      } as never),
    ).toBeNull();
    expect(
      resolveSegment({
        ...base,
        title: 'Palnadu district review',
        content: 'collector meeting',
      } as never),
    ).toBeNull();
  });
});

describe('CombinedPipelineService', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.WHATSAPP_ENABLED = 'false';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('runs collect → groq stages → upsert and survives a YouTube failure', async () => {
    process.env.GROQ_API_KEY = 'test-key';
    process.env.YOUTUBE_API_KEY = 'yt';
    process.env.EMAIL_ENABLED = 'false';
    process.env.WHATSAPP_ENABLED = 'false';
    process.env.PIPELINE_MAX_ANALYZE = '3';
    process.env.SAKSHI_TAG_URLS = 'https://www.sakshi.com/tags/narasaraopet';

    const updates: Array<Record<string, unknown>> = [];
    const db = {
      ensureConnected: async () => true,
      articlesCollectionName: 'articles',
      collection: () => ({
        updateOne: async (
          filter: { post_id: string },
          update: { $set: Record<string, unknown> },
        ) => {
          updates.push({ post_id: filter.post_id, ...update.$set });
          return { upsertedCount: 1, matchedCount: 0 };
        },
      }),
    };

    const service = new CombinedPipelineService(
      db as unknown as DatabaseService,
    );
    let groqCalls = 0;
    const fetchImpl = (async (url: string) => {
      const target = String(url);
      if (target.includes('getlokalapp.com')) {
        if (!target.includes('page=1')) return jsonResponse({ results: [] });
        return jsonResponse({
          results: [
            {
              id: 42,
              title: 'నరసరావుపేట రోడ్డు',
              content:
                'నరసరావుపేట పట్టణంలో రోడ్లపై గుంతలు ఏర్పడి వాహనదారులు ఇబ్బంది పడుతున్నారు',
              created_on: new Date().toISOString(),
            },
          ],
        });
      }
      if (target.includes('googleapis.com')) {
        return jsonResponse({}, 403);
      }
      if (target.includes('sakshi.com/tags')) {
        return {
          ok: true,
          status: 200,
          text: async () =>
            '<a href="https://www.sakshi.com/news/palnadu/narasaraopet-story-123456">x</a>',
          json: async () => ({}),
        } as Response;
      }
      if (target.includes('story-123456')) {
        const body = 'Narasaraopet '.repeat(20);
        return {
          ok: true,
          status: 200,
          text: async () =>
            `<meta property="og:title" content="Narasaraopet road"><p>${body}</p>`,
          json: async () => ({}),
        } as Response;
      }
      if (target.includes('api.groq.com')) {
        groqCalls += 1;
        const stage = groqCalls % 3;
        const payload =
          stage === 1
            ? {
                sentiment: 'Problem',
                category: 'roads',
                subcategory: 'civic',
                problem: 'potholes',
                severity: 'high',
                authority: 'municipality',
              }
            : stage === 2
              ? {
                  location: { district: 'Palnadu', state: 'Andhra Pradesh' },
                  people: [],
                  entities: [],
                  keywords: ['road'],
                }
              : { summary: 'రోడ్డు దెబ్బతింది' };
        return jsonResponse({
          choices: [{ message: { content: JSON.stringify(payload) } }],
        });
      }
      return jsonResponse({}, 404);
    }) as typeof fetch;

    const result = await service.runCombinedOnce({ fetchImpl });
    expect(groqCalls).toBeGreaterThanOrEqual(3);
    expect(result.stats.lokal_processed).toBe(1);
    expect(result.stats.inserted).toBeGreaterThanOrEqual(1);
    expect(result.stats.errors.some((e) => e.startsWith('youtube_http_'))).toBe(
      true,
    );
    expect(updates.some((row) => row.post_id === '42')).toBe(true);
    expect(
      updates.some((row) => String(row.post_id).startsWith('sakshi_')),
    ).toBe(true);
    expect(updates[0].problem_id).toEqual(expect.stringMatching(/^PROB-/));
    expect(
      updates.every(
        (row) =>
          row.assembly_segment === 'Narasaraopet' &&
          row.constituency === 'Narasaraopet',
      ),
    ).toBe(true);
    const again = await service.runCombinedOnce({ fetchImpl });
    expect(again.stats.inserted).toBeGreaterThanOrEqual(1);
  });

  it('emails new articles every cycle and failures once per problem, with no WhatsApp alert', async () => {
    process.env.GROQ_API_KEY = 'test-key';
    process.env.WHATSAPP_ENABLED = 'true';
    process.env.WHATSAPP_ACCESS_TOKEN = 'test-token';
    process.env.WHATSAPP_PHONE_NUMBER_ID = '987654321';
    process.env.WHATSAPP_RECIPIENTS = '919876543210';
    delete process.env.WHATSAPP_ALERTS_ENABLED;
    process.env.EMAIL_ENABLED = 'true';
    process.env.EMAIL_PROVIDER = 'resend';
    process.env.RESEND_API_KEY = 'test';
    process.env.SMTP_FROM_EMAIL = 'from@example.com';
    process.env.REPORT_RECIPIENTS = 'desk@example.com';
    process.env.YOUTUBE_ENABLED = 'false';
    process.env.SAKSHI_TAG_URLS = 'https://www.sakshi.com/tags/narasaraopet';
    process.env.PIPELINE_MAX_ANALYZE = '2';

    let postId = 100;
    const db = {
      ensureConnected: async () => true,
      articlesCollectionName: 'articles',
      collection: () => ({
        find: () => ({ limit: () => ({ toArray: async () => [] }) }),
        updateOne: async () => ({ upsertedCount: 1, matchedCount: 0 }),
      }),
    };
    const service = new CombinedPipelineService(
      db as unknown as DatabaseService,
    );
    const emails: Array<{ subject: string; html: string }> = [];
    let whatsappCalls = 0;
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      const target = String(url);
      if (target.includes('getlokalapp.com')) {
        if (!target.includes('page=1')) return jsonResponse({ results: [] });
        postId += 1;
        return jsonResponse({
          results: [
            {
              id: postId,
              title: `Narasaraopet road ${postId}`,
              content: 'Narasaraopet town roads need repair after rain',
              created_on: new Date().toISOString(),
            },
          ],
        });
      }
      if (target.includes('sakshi.com')) return jsonResponse({}, 403);
      if (target.includes('graph.facebook.com')) {
        whatsappCalls += 1;
        return jsonResponse({ messages: [{ id: 'wamid.x' }] });
      }
      if (target.includes('api.resend.com')) {
        emails.push(JSON.parse(String(init?.body)));
        return jsonResponse({ id: 'mail' });
      }
      return jsonResponse({
        choices: [
          {
            message: {
              content:
                '{"sentiment":"Problem","category":"roads","problem":"potholes","severity":"high","summary":"s","location":{"district":"Palnadu"},"people":[],"entities":[],"keywords":[]}',
            },
          },
        ],
      });
    }) as typeof fetch;
    const failures = () =>
      emails.filter((mail) =>
        mail.subject.startsWith('MediaSphere pipeline FAILED'),
      );
    const news = () =>
      emails.filter((mail) =>
        /^MediaSphere: 1 new article, 1 critical \|/.test(mail.subject),
      );

    const failed = await service.runCombinedOnce({ fetchImpl });
    expect(failed.exitCode).toBe(0);
    expect(failed.stats.errors).toContain('sakshi_http_403');
    expect(failed.stats.inserted).toBe(1);
    expect(failures()).toHaveLength(1);
    expect(news()).toHaveLength(1);
    expect(news()[0].html).toContain('CRITICAL ISSUE: Narasaraopet road 101');
    expect(news()[0].html).toContain('<strong>Location:</strong> Palnadu');

    await service.runCombinedOnce({ fetchImpl });
    expect(failures()).toHaveLength(1);
    expect(news()).toHaveLength(2);

    process.env.SAKSHI_ENABLED = 'false';
    const ok = await service.runCombinedOnce({ fetchImpl });
    expect(ok.exitCode).toBe(0);
    expect(ok.stats.inserted).toBe(1);
    expect(failures()).toHaveLength(1);
    expect(news()).toHaveLength(3);

    process.env.SAKSHI_ENABLED = 'true';
    await service.runCombinedOnce({ fetchImpl });
    expect(failures()).toHaveLength(2);
    expect(news()).toHaveLength(4);
    expect(emails).toHaveLength(6);
    expect(whatsappCalls).toBe(3);

    process.env.NEWS_EMAIL_ENABLED = 'false';
    await service.runCombinedOnce({ fetchImpl });
    expect(news()).toHaveLength(4);
  });

  it('skips saved and already-checked items so new articles get the analysis slots', async () => {
    process.env.GROQ_API_KEY = 'test-key';
    process.env.YOUTUBE_ENABLED = 'false';
    process.env.SAKSHI_ENABLED = 'false';
    process.env.EMAIL_ENABLED = 'false';
    process.env.PIPELINE_MAX_ANALYZE = '1';
    const remembered: string[][] = [];
    const upserted: string[] = [];
    const db = {
      ensureConnected: async () => true,
      articlesCollectionName: 'articles',
      query: async (sql: string, params: unknown[]) => {
        if (sql.includes('INSERT')) remembered.push(params[1] as string[]);
        if (sql.includes("doc->>'post_id'"))
          return [{ post_id: '1', source_url: null }];
        if (sql.includes('SELECT doc_id')) return [{ doc_id: 'post:2' }];
        return [];
      },
      collection: () => ({
        find: () => ({ limit: () => ({ toArray: async () => [] }) }),
        updateOne: async (filter: { post_id: string }) => {
          upserted.push(filter.post_id);
          return { upsertedCount: 1, matchedCount: 0 };
        },
      }),
    };
    const service = new CombinedPipelineService(
      db as unknown as DatabaseService,
    );
    const fetchImpl = (async (url: string) => {
      if (String(url).includes('getlokalapp.com')) {
        if (!String(url).includes('page=1'))
          return jsonResponse({ results: [] });
        const now = new Date().toISOString();
        return jsonResponse({
          results: [1, 2, 3].map((id) => ({
            id,
            title: `Narasaraopet road ${id}`,
            content: `Narasaraopet town road number ${id} needs repair after rain`,
            created_on: now,
          })),
        });
      }
      return jsonResponse({
        choices: [
          {
            message: {
              content:
                '{"sentiment":"Statement","category":"c","problem":"p","summary":"s","location":{"district":"d"},"people":[],"entities":[],"keywords":[]}',
            },
          },
        ],
      });
    }) as typeof fetch;

    const result = await service.runCombinedOnce({ fetchImpl });
    expect(upserted).toEqual(['3']);
    expect(result.stats.inserted).toBe(1);
    expect(result.stats.duplicates).toBeGreaterThanOrEqual(2);
    expect(remembered).toEqual([]);
  });

  it('skips saved and already-checked items so new articles get the analysis slots', async () => {
    process.env.GROQ_API_KEY = 'test-key';
    process.env.YOUTUBE_ENABLED = 'false';
    process.env.SAKSHI_ENABLED = 'false';
    process.env.EMAIL_ENABLED = 'false';
    process.env.PIPELINE_MAX_ANALYZE = '1';
    const remembered: string[][] = [];
    const upserted: string[] = [];
    const db = {
      ensureConnected: async () => true,
      articlesCollectionName: 'articles',
      query: async (sql: string, params: unknown[]) => {
        if (sql.includes('INSERT')) remembered.push(params[1] as string[]);
        if (sql.includes("doc->>'post_id'"))
          return [{ post_id: '1', source_url: null }];
        if (sql.includes('SELECT doc_id')) return [{ doc_id: 'post:2' }];
        return [];
      },
      collection: () => ({
        find: () => ({ limit: () => ({ toArray: async () => [] }) }),
        updateOne: async (filter: { post_id: string }) => {
          upserted.push(filter.post_id);
          return { upsertedCount: 1, matchedCount: 0 };
        },
      }),
    };
    const service = new CombinedPipelineService(
      db as unknown as DatabaseService,
    );
    const fetchImpl = (async (url: string) => {
      if (String(url).includes('getlokalapp.com')) {
        if (!String(url).includes('page=1'))
          return jsonResponse({ results: [] });
        const now = new Date().toISOString();
        return jsonResponse({
          results: [1, 2, 3].map((id) => ({
            id,
            title: `Narasaraopet road ${id}`,
            content: `Narasaraopet town road number ${id} needs repair after rain`,
            created_on: now,
          })),
        });
      }
      return jsonResponse({
        choices: [
          {
            message: {
              content:
                '{"sentiment":"Statement","category":"c","problem":"p","summary":"s","location":{"district":"d"},"people":[],"entities":[],"keywords":[]}',
            },
          },
        ],
      });
    }) as typeof fetch;

    const result = await service.runCombinedOnce({ fetchImpl });
    expect(upserted).toEqual(['3']);
    expect(result.stats.inserted).toBe(1);
    expect(result.stats.duplicates).toBeGreaterThanOrEqual(2);
    expect(remembered).toEqual([]);
  });

  it('second upsert of the same post_id is a duplicate', async () => {
    process.env.GROQ_API_KEY = 'test-key';
    process.env.YOUTUBE_ENABLED = 'false';
    process.env.SAKSHI_ENABLED = 'false';
    process.env.PIPELINE_MAX_ANALYZE = '1';
    let seen = false;
    const db = {
      ensureConnected: async () => true,
      articlesCollectionName: 'articles',
      collection: () => ({
        updateOne: async () => {
          if (!seen) {
            seen = true;
            return { upsertedCount: 1, matchedCount: 0 };
          }
          return { upsertedCount: 0, matchedCount: 1 };
        },
      }),
    };
    const service = new CombinedPipelineService(
      db as unknown as DatabaseService,
    );
    const fetchImpl = (async (url: string) => {
      if (String(url).includes('getlokalapp.com')) {
        if (!String(url).includes('page=1'))
          return jsonResponse({ results: [] });
        return jsonResponse({
          results: [
            {
              id: 7,
              title: 'Narasaraopet road',
              content:
                'Narasaraopet civic update about the town roads and water supply today',
              created_on: new Date().toISOString(),
            },
          ],
        });
      }
      return jsonResponse({
        choices: [
          {
            message: {
              content:
                '{"sentiment":"Statement","category":"c","problem":"p","summary":"s","location":{"district":"d"},"people":[],"entities":[],"keywords":[]}',
            },
          },
        ],
      });
    }) as typeof fetch;
    const first = await service.runCombinedOnce({ fetchImpl });
    const second = await service.runCombinedOnce({ fetchImpl });
    expect(first.stats.inserted).toBe(1);
    expect(second.stats.inserted).toBe(0);
    expect(second.stats.duplicates).toBeGreaterThanOrEqual(1);
  });
});
