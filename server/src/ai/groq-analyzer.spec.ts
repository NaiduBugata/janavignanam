import {
  analyzeNewsArticle,
  extractEntities,
  validateAnalysis,
} from './groq-analyzer';
import { normalizeCategory, normalizeDistrict } from './groq-normalizer';

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

function stagePayload(call: number): Record<string, unknown> {
  const stage = call % 3;
  if (stage === 1) {
    return {
      sentiment: 'Problem',
      category: 'roads',
      subcategory: 'civic works',
      problem: 'potholes',
      severity: 'high',
      authority: 'municipality',
      confidence: 0.9,
    };
  }
  if (stage === 2) {
    return {
      location: { district: 'నరసరావుపేట', mandal: 'Narasaraopet' },
      people: [{ name: 'Ravi Kumar', designation: 'MLA' }],
      entities: [],
      keywords: ['road', 'Road'],
    };
  }
  return { summary: 'రోడ్డు దెబ్బతింది' };
}

describe('groq normalizer', () => {
  it('maps category aliases and district names the way Python does', () => {
    expect(normalizeCategory('roads')).toBe('Roads');
    expect(normalizeCategory('వార్త')).toBe('Other');
    expect(normalizeCategory('roadss')).toBe('Roads');
    expect(normalizeDistrict('నరసరావుపేట')).toBe('Palnadu');
    expect(normalizeDistrict('పల్నాడు జిల్లా')).toBe('Palnadu');
  });
});

describe('analyzeNewsArticle', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('rejects a missing key, an empty article, and a short article before calling Groq', async () => {
    delete process.env.GROQ_API_KEY;
    delete process.env.GROQ_API_KEYS;
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('GROQ_API_KEY')) delete process.env[key];
    }
    const content = 'నరసరావుపేట పట్టణంలో రోడ్లపై గుంతలు ఏర్పడ్డాయి';
    await expect(
      analyzeNewsArticle({ articleId: '1', title: 't', content }),
    ).rejects.toThrow('no_groq_keys');

    process.env.GROQ_API_KEY = 'test-key';
    await expect(
      analyzeNewsArticle({ articleId: '1', title: '  ', content: '  ' }),
    ).rejects.toThrow('empty_article');
    await expect(
      analyzeNewsArticle({ articleId: '1', title: 't', content: 'short' }),
    ).rejects.toThrow('short_article');
  });

  it('merges three stages, assigns a problem id, and accepts a short summary', async () => {
    process.env.GROQ_API_KEY = 'test-key';
    process.env.MAX_RETRIES = '2';
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return jsonResponse({
        choices: [
          { message: { content: JSON.stringify(stagePayload(calls)) } },
        ],
      });
    }) as typeof fetch;

    const analysis = await analyzeNewsArticle(
      {
        articleId: '42',
        title: 'నరసరావుపేట రోడ్డు',
        content:
          'నరసరావుపేట పట్టణంలో రోడ్లపై గుంతలు ఏర్పడి వాహనదారులు ఇబ్బంది పడుతున్నారు',
      },
      fetchImpl,
    );

    expect(calls).toBe(3);
    expect(analysis.sentiment).toBe('Problem');
    expect(analysis.category).toBe('Roads');
    expect(analysis.problem_id).toEqual(expect.stringMatching(/^PROB-/));
    expect(analysis.article_id).toBe('42');
    expect((analysis.location as { district: string }).district).toBe(
      'Palnadu',
    );
    expect(analysis.keywords).toEqual(['road']);
    expect(analysis.subcategory).toBe('civic works');
    const issues = validateAnalysis(analysis);
    expect(
      issues.some(
        (item) => item.severity === 'CRITICAL' || item.severity === 'ERROR',
      ),
    ).toBe(false);
    expect(
      issues.some(
        (item) => item.field === 'summary' && item.severity === 'WARNING',
      ),
    ).toBe(true);
    expect(typeof analysis.quality_score).toBe('number');
  });

  it('retries a rate limit and rejects a missing title', async () => {
    process.env.GROQ_API_KEY = 'test-key';
    process.env.MAX_RETRIES = '3';
    process.env.COOLDOWN_SECONDS = '0';
    let calls = 0;
    let stage = 0;
    const fetchImpl = (async () => {
      calls += 1;
      if (calls === 1) return jsonResponse({}, 429);
      stage += 1;
      return jsonResponse({
        choices: [
          { message: { content: JSON.stringify(stagePayload(stage)) } },
        ],
      });
    }) as typeof fetch;

    const analysis = await analyzeNewsArticle(
      {
        articleId: '9',
        title: 'Narasaraopet water',
        content:
          'Narasaraopet municipal water supply was interrupted across several wards today',
      },
      fetchImpl,
    );
    expect(calls).toBe(4);
    expect(analysis.sentiment).toBe('Problem');

    let rejectCalls = 0;
    const rejecting = (async () => {
      rejectCalls += 1;
      return jsonResponse({
        choices: [
          { message: { content: JSON.stringify(stagePayload(rejectCalls)) } },
        ],
      });
    }) as typeof fetch;
    await expect(
      analyzeNewsArticle(
        { articleId: 'x', title: '   ', content: 'x'.repeat(40) },
        rejecting,
      ),
    ).rejects.toThrow('decision_reject');
    expect(rejectCalls).toBe(3);
  });

  it('pulls people, places, and party names from the article text', () => {
    const entities = extractEntities('టిడిపి సమావేశం', 'నరసరావుపేట కార్యాలయం', {
      people: [{ name: 'Lakshmi Devi' }],
      location: { district: 'Palnadu', mandal: 'Narasaraopet' },
      summary: '',
    });
    expect(
      entities.some(
        (item) => item.type === 'Person' && item.name === 'Lakshmi Devi',
      ),
    ).toBe(true);
    expect(
      entities.some(
        (item) => item.type === 'District' && item.name === 'Palnadu',
      ),
    ).toBe(true);
    expect(entities.some((item) => item.type === 'Political Party')).toBe(true);
  });
});
