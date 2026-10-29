import {
  ASSEMBLY_SEGMENTS,
  hasAssemblySegment,
  mapSegment,
  parseSegmentAnswer,
  scoreConstituency,
  validateConstituency,
} from './constituency';

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

describe('seven assembly segments', () => {
  it('lists exactly the seven segments of the constituency', () => {
    expect([...ASSEMBLY_SEGMENTS]).toEqual([
      'Pedakurapadu',
      'Chilakaluripet',
      'Narasaraopet',
      'Sattenapalle',
      'Vinukonda',
      'Gurazala',
      'Macherla',
    ]);
  });

  it.each([
    ['పెదకూరపాడు లో రైతుల ధర్నా', 'Pedakurapadu'],
    ['Chilakaluripet municipal council meeting', 'Chilakaluripet'],
    ['నరసరావుపేట లో రోడ్డు పనులు', 'Narasaraopet'],
    ['Sattenapalle hospital opens new ward', 'Sattenapalle'],
    ['Vinukonda water supply restored', 'Vinukonda'],
    ['గురజాల లో విద్యుత్ సమస్య', 'Gurazala'],
    ['Macherla bus stand repairs', 'Macherla'],
  ])('maps "%s" to %s', (text, segment) => {
    expect(mapSegment(text).segment).toBe(segment);
    expect(scoreConstituency(text)).toMatchObject({
      valid: true,
      segment,
      reason: 'segment_match',
    });
  });

  it('treats Sattenpalli and Sattenapalli as the Sattenapalle segment', () => {
    expect(mapSegment('Sattenpalli farmers protest').segment).toBe(
      'Sattenapalle',
    );
    expect(mapSegment('Sattenapalli police station').segment).toBe(
      'Sattenapalle',
    );
    expect(mapSegment('సత్తెనపల్లి లో ర్యాలీ').segment).toBe('Sattenapalle');
    expect(parseSegmentAnswer('Sattenpalli')).toBe('Sattenapalle');
  });

  it('maps a mandal or landmark to its segment', () => {
    expect(mapSegment('Piduguralla lime kiln workers').segment).toBe(
      'Gurazala',
    );
    expect(mapSegment('Kotappakonda festival crowd').segment).toBe(
      'Narasaraopet',
    );
    expect(mapSegment('Karempudi temple fair').segment).toBe('Macherla');
  });

  it('does not map the district, the MP seat, or ambiguous names on their own', () => {
    expect(
      mapSegment('Palnadu district collector reviews schemes').segment,
    ).toBeNull();
    expect(
      mapSegment('Narasaraopet MP meets the Chief Minister in Delhi').segment,
    ).toBeNull();
    expect(mapSegment('నరసరావుపేట ఎంపీ ప్రెస్ మీట్').segment).toBeNull();
    expect(
      mapSegment('Nadendla Manohar speaks at party office').segment,
    ).toBeNull();
    expect(mapSegment('Amaravati capital works resume').segment).toBeNull();
  });

  it('counts an ambiguous name when the district or its segment corroborates it', () => {
    expect(
      mapSegment('Nadendla village, Palnadu district, gets new road').segment,
    ).toBe('Chilakaluripet');
    expect(mapSegment('Chilakaluripet and Nadendla farmers').matches).toEqual(
      expect.arrayContaining(['Chilakaluripet', 'Nadendla']),
    );
  });

  it('drops articles from outside the seven segments', () => {
    for (const text of [
      'Guntur city traffic jam',
      'Mumbai cinema premiere tonight',
      'A quiet afternoon with no place names',
      'Phirangipuram school event',
      'Nagarjunasagar dam gates opened',
    ]) {
      expect(scoreConstituency(text)).toMatchObject({
        valid: false,
        reason: 'no_segment',
        segment: null,
      });
    }
  });

  it('prefers the segment with the most evidence', () => {
    const text =
      'Briefing at Narasaraopet police HQ about thefts in Edlapadu, Nadendla and Chilakaluripet';
    expect(mapSegment(text).segment).toBe('Chilakaluripet');
  });

  it('still filters city or cinema stories that only mention a segment in passing', () => {
    expect(
      scoreConstituency('Hyderabad office for Pidugurala traders').reason,
    ).toBe('negative_filter');
  });

  it('recognises stored docs that carry one of the seven segments', () => {
    expect(hasAssemblySegment({ assembly_segment: 'Macherla' })).toBe(true);
    expect(hasAssemblySegment({ assembly_segment: 'Guntur' })).toBe(false);
    expect(hasAssemblySegment({})).toBe(false);
  });
});

describe('borderline constituency check', () => {
  const original = { ...process.env };

  afterEach(() => {
    process.env = { ...original };
  });

  it('accepts a single-mandal mention only when Groq names the same segment', async () => {
    process.env.GROQ_API_KEY = 'test-key';
    process.env.CONSTITUENCY_AI_VALIDATION = 'true';
    const calls: string[] = [];
    const fetchImpl = (async (url: string) => {
      calls.push(String(url));
      return jsonResponse({ choices: [{ message: { content: 'Macherla' } }] });
    }) as typeof fetch;

    const accepted = await validateConstituency(
      { title: 'Durgi school day', content: 'A local event.' },
      fetchImpl,
    );
    expect(accepted).toMatchObject({
      valid: true,
      reason: 'ai_confirmed_segment',
      segment: 'Macherla',
      ai_decision: 'Macherla',
    });
    expect(calls).toEqual(['https://api.groq.com/openai/v1/chat/completions']);

    const otherSegment = await validateConstituency(
      { title: 'Durgi school day', content: 'A local event.' },
      async () =>
        jsonResponse({
          choices: [{ message: { content: 'Vinukonda' } }],
        }),
    );
    expect(otherSegment).toMatchObject({
      valid: false,
      reason: 'ai_other_segment_or_none',
    });

    const none = await validateConstituency(
      { title: 'Durgi school day', content: 'A local event.' },
      async () =>
        jsonResponse({
          choices: [{ message: { content: 'NONE' } }],
        }),
    );
    expect(none).toMatchObject({
      valid: false,
      reason: 'ai_other_segment_or_none',
      ai_decision: 'NONE',
    });
  });

  it('does not call Groq when AI validation is off or the evidence is already decided', async () => {
    process.env.GROQ_API_KEY = 'test-key';
    process.env.CONSTITUENCY_AI_VALIDATION = 'false';
    const fetchImpl = (async () => {
      throw new Error('groq should not be called');
    }) as typeof fetch;
    const borderline = await validateConstituency(
      { title: 'Durgi fair', content: 'crowd' },
      fetchImpl,
    );
    expect(borderline).toMatchObject({
      valid: false,
      reason: 'borderline_no_ai',
    });
    const strong = await validateConstituency(
      { title: 'Narasaraopet roads', content: 'repair' },
      fetchImpl,
    );
    expect(strong).toMatchObject({
      valid: true,
      reason: 'segment_match',
      segment: 'Narasaraopet',
    });
    const outside = await validateConstituency(
      { title: 'Guntur roads', content: 'repair' },
      fetchImpl,
      true,
    );
    expect(outside).toMatchObject({ valid: false, reason: 'no_segment' });
  });

  it('treats a missing key as uncertain and rejects the article', async () => {
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('GROQ_API_KEY')) delete process.env[key];
    }
    process.env.CONSTITUENCY_AI_VALIDATION = 'true';
    const result = await validateConstituency(
      { title: 'Durgi fair', content: 'crowd' },
      fetch,
    );
    expect(result).toMatchObject({ valid: false, reason: 'ai_uncertain' });
  });
});
