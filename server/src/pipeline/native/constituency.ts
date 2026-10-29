import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { discoverGroqApiKeys } from '../../ai/groq-keys';

/** The only seven assembly segments of the Narasaraopet Parliamentary Constituency. */
export const ASSEMBLY_SEGMENTS = [
  'Pedakurapadu',
  'Chilakaluripet',
  'Narasaraopet',
  'Sattenapalle',
  'Vinukonda',
  'Gurazala',
  'Macherla',
] as const;

export type AssemblySegment = (typeof ASSEMBLY_SEGMENTS)[number];

interface SegmentEntry {
  names?: string[];
  mandals?: string[];
  /** Names shared with surnames or places elsewhere. They count only beside another clue for the same segment or the district. */
  ambiguous?: string[];
  landmarks?: string[];
}

interface Dict {
  constituency?: string;
  segments?: Record<string, SegmentEntry>;
  constituency_references?: string[];
  district_aliases?: string[];
  scoring?: Record<string, number>;
  negative_keywords?: string[];
  negative_categories?: string[];
  ai_validation?: { enabled?: boolean };
}

export interface SegmentMatch {
  segment: AssemblySegment | null;
  evidence: number;
  matches: string[];
}

export interface ScoreResult {
  valid: boolean;
  score: number;
  reason: string;
  segment: AssemblySegment | null;
  ai_decision?: string | null;
}

let cached: Dict | null = null;

export function loadDictionary(): Dict {
  if (cached) return cached;
  const path = process.env.LOCATION_DICTIONARY_PATH
    ? resolve(process.cwd(), process.env.LOCATION_DICTIONARY_PATH)
    : resolve(__dirname, '../data/location_dictionary.json');
  const data = JSON.parse(readFileSync(path, 'utf8')) as Dict;
  const unknown = Object.keys(data.segments || {}).filter(
    (name) => !(ASSEMBLY_SEGMENTS as readonly string[]).includes(name),
  );
  if (unknown.length)
    throw new Error(
      `location dictionary lists segments outside the constituency: ${unknown.join(', ')}`,
    );
  cached = data;
  return cached;
}

export function hasAssemblySegment(doc: {
  assembly_segment?: unknown;
}): boolean {
  return (
    typeof doc.assembly_segment === 'string' &&
    (ASSEMBLY_SEGMENTS as readonly string[]).includes(doc.assembly_segment)
  );
}

/** Every place word for the seven segments, for URL ranking and search. */
export function constituencyKeywords(): string[] {
  const data = loadDictionary();
  const words: string[] = [];
  for (const entry of Object.values(data.segments || {})) {
    words.push(
      ...(entry.names || []),
      ...(entry.mandals || []),
      ...(entry.ambiguous || []),
      ...(entry.landmarks || []),
    );
  }
  return [...new Set(words.map((word) => word.trim()).filter(Boolean))];
}

function firstIndex(haystack: string, keyword: string): number {
  if (!keyword) return -1;
  if ([...keyword].some((ch) => ch.charCodeAt(0) > 127))
    return haystack.indexOf(keyword);
  const pattern = keyword
    .toLowerCase()
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\s+/g, '\\s+');
  const match = new RegExp(
    `(?<![\\p{L}\\p{N}])${pattern}(?![\\p{L}\\p{N}])`,
    'iu',
  ).exec(haystack);
  return match ? match.index : -1;
}

function findMatches(
  haystack: string,
  keywords: string[] = [],
): Array<{ word: string; at: number }> {
  return keywords
    .map((word) => ({ word, at: firstIndex(haystack, word) }))
    .filter((hit) => hit.at >= 0);
}

function stripConstituencyReferences(
  text: string,
  references: string[] = [],
): string {
  let out = text;
  for (const phrase of references) {
    if (!phrase) continue;
    const pattern = phrase
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\s+/g, '\\s*');
    out = out.replace(new RegExp(pattern, 'giu'), ' ');
  }
  return out;
}

/**
 * Map text to exactly one of the seven segments, or none.
 * "Narasaraopet MP" and similar name the parliamentary seat, not the Narasaraopet segment, so they are ignored.
 * The district name alone never maps an article.
 */
export function mapSegment(text: string): SegmentMatch {
  const data = loadDictionary();
  const weights = {
    name: data.scoring?.name ?? 10,
    mandal: data.scoring?.mandal ?? 4,
    landmark: data.scoring?.landmark ?? 6,
  };
  const haystack = stripConstituencyReferences(
    text,
    data.constituency_references,
  );
  const districtNamed = findMatches(haystack, data.district_aliases).length > 0;
  let best: {
    segment: AssemblySegment;
    evidence: number;
    at: number;
    matches: string[];
  } | null = null;

  for (const segment of ASSEMBLY_SEGMENTS) {
    const entry = data.segments?.[segment];
    if (!entry) continue;
    const names = findMatches(haystack, entry.names);
    const mandals = findMatches(haystack, entry.mandals);
    const landmarks = findMatches(haystack, entry.landmarks);
    const ambiguous = findMatches(haystack, entry.ambiguous);
    const corroborated =
      names.length > 0 ||
      mandals.length > 0 ||
      landmarks.length > 0 ||
      districtNamed;
    const usable = [
      ...names,
      ...mandals,
      ...landmarks,
      ...(corroborated ? ambiguous : []),
    ];
    if (!usable.length) continue;
    const distinctMandals =
      mandals.length + (corroborated ? ambiguous.length : 0);
    let evidence = 0;
    if (names.length) evidence += weights.name;
    if (landmarks.length) evidence += weights.landmark;
    if (distinctMandals)
      evidence += weights.mandal + Math.min(4, (distinctMandals - 1) * 2);
    const at = Math.min(...usable.map((hit) => hit.at));
    if (
      !best ||
      evidence > best.evidence ||
      (evidence === best.evidence && at < best.at)
    ) {
      best = { segment, evidence, at, matches: usable.map((hit) => hit.word) };
    }
  }
  return best
    ? { segment: best.segment, evidence: best.evidence, matches: best.matches }
    : { segment: null, evidence: 0, matches: [] };
}

/** Segment evidence plus the city, national, sports, and cinema filter. */
export function scoreConstituency(text: string, category = ''): ScoreResult {
  const data = loadDictionary();
  const accept = Number(
    process.env.CONSTITUENCY_SCORE_THRESHOLD ||
      process.env.SAKSHI_CONSTITUENCY_SCORE_THRESHOLD ||
      data.scoring?.accept_threshold ||
      6,
  );
  const borderline = data.scoring?.borderline_low ?? 3;
  const override = data.scoring?.negative_override_score ?? 12;
  const penalty = data.scoring?.negative_penalty ?? 8;

  const mapped = mapSegment(text);
  if (!mapped.segment)
    return { valid: false, score: 0, reason: 'no_segment', segment: null };

  const negative = findMatches(text, data.negative_keywords).map(
    (hit) => hit.word,
  );
  for (const neg of data.negative_categories || []) {
    if (
      neg &&
      category.toLowerCase().includes(neg.toLowerCase()) &&
      !negative.includes(neg)
    )
      negative.push(neg);
  }
  const score = mapped.evidence;
  if (negative.length && score < override) {
    return {
      valid: false,
      score: Math.max(0, score - penalty),
      reason: 'negative_filter',
      segment: mapped.segment,
    };
  }
  if (score >= accept)
    return {
      valid: true,
      score,
      reason: 'segment_match',
      segment: mapped.segment,
    };
  if (score >= borderline)
    return {
      valid: false,
      score,
      reason: 'borderline',
      segment: mapped.segment,
    };
  return {
    valid: false,
    score,
    reason: 'score_below_threshold',
    segment: mapped.segment,
  };
}

export function buildSearchableText(raw: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const key of [
    'title',
    'description',
    'summary',
    'og_description',
    'content',
    'article',
    'category',
  ]) {
    const value = raw[key];
    if (typeof value === 'string' && value.trim()) parts.push(value.trim());
  }
  if (Array.isArray(raw.tags))
    parts.push(...raw.tags.map((item) => String(item).trim()).filter(Boolean));
  if (Array.isArray(raw.breadcrumb))
    parts.push(
      ...raw.breadcrumb.map((item) => String(item).trim()).filter(Boolean),
    );
  else if (typeof raw.breadcrumb === 'string' && raw.breadcrumb.trim())
    parts.push(raw.breadcrumb.trim());
  const location = raw.location;
  if (location && typeof location === 'object' && !Array.isArray(location)) {
    for (const key of ['district', 'mandal', 'village', 'town', 'state']) {
      const value = (location as Record<string, unknown>)[key];
      if (value) parts.push(String(value));
    }
  }
  return parts.join('\n');
}

function constituencyAiEnabled(useAi?: boolean): boolean {
  if (useAi !== undefined) return useAi;
  const env = (
    process.env.CONSTITUENCY_AI_VALIDATION ||
    process.env.SAKSHI_AI_VALIDATION ||
    ''
  )
    .trim()
    .toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(env)) return true;
  if (['0', 'false', 'no', 'off'].includes(env)) return false;
  return loadDictionary().ai_validation?.enabled !== false;
}

export function parseSegmentAnswer(
  content: string,
): AssemblySegment | 'NONE' | 'UNCERTAIN' {
  const upper = content.trim().toUpperCase();
  const aliases: Array<[string, AssemblySegment]> = [
    ['SATTENAPALLI', 'Sattenapalle'],
    ['SATTENPALLI', 'Sattenapalle'],
    ['GURAJALA', 'Gurazala'],
    ...ASSEMBLY_SEGMENTS.map((segment): [string, AssemblySegment] => [
      segment.toUpperCase(),
      segment,
    ]),
  ];
  const found = new Set(
    aliases
      .filter(([alias]) => upper.includes(alias))
      .map(([, segment]) => segment),
  );
  if (found.size === 1) return [...found][0];
  if (found.size > 1) return 'UNCERTAIN';
  if (upper.includes('NONE') || upper === 'NO') return 'NONE';
  return 'UNCERTAIN';
}

/** Groq names the one segment the article belongs to, or NONE. Used only for weak evidence. */
export async function checkBorderlineConstituency(
  raw: Record<string, unknown>,
  text: string,
  fetchImpl: typeof fetch = fetch,
): Promise<AssemblySegment | 'NONE' | 'UNCERTAIN'> {
  const keys = discoverGroqApiKeys();
  if (!keys.length) return 'UNCERTAIN';
  const title = String(raw.title || '').slice(0, 300);
  const prompt =
    'The Narasaraopet Parliamentary Constituency in Andhra Pradesh has exactly seven assembly segments: ' +
    `${ASSEMBLY_SEGMENTS.join(', ')}. Sattenapalli is the same segment as Sattenapalle.\n\n` +
    'Which one of these seven segments is this news article primarily about? ' +
    'If it is about a place outside these seven segments, or you cannot tell, answer NONE.\n\n' +
    'Answer with exactly one segment name from the list, or NONE.\n\n' +
    `Title: ${title}\n\nArticle excerpt:\n${text.slice(0, 2500)}`;
  try {
    const model =
      process.env.CONSTITUENCY_AI_VALIDATION_MODEL ||
      process.env.SAKSHI_AI_VALIDATION_MODEL ||
      'openai/gpt-oss-20b';
    const response = await fetchImpl(
      'https://api.groq.com/openai/v1/chat/completions',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${keys[0]}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          temperature: 0,
          max_tokens: 300,
          ...(model.startsWith('openai/gpt-oss')
            ? { reasoning_effort: 'low' }
            : {}),
          messages: [
            {
              role: 'system',
              content: `You map news articles to one of these assembly segments: ${ASSEMBLY_SEGMENTS.join(', ')}. Reply with only one segment name or NONE.`,
            },
            { role: 'user', content: prompt },
          ],
        }),
      },
    );
    if (!response.ok) return 'UNCERTAIN';
    const body = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    return parseSegmentAnswer(body.choices?.[0]?.message?.content || '');
  } catch {
    return 'UNCERTAIN';
  }
}

/**
 * Accept an article only when it maps to one of the seven segments.
 * Weak evidence (one mandal or landmark) also needs Groq to name the same segment.
 */
export async function validateConstituency(
  raw: Record<string, unknown>,
  fetchImpl: typeof fetch = fetch,
  useAi?: boolean,
): Promise<ScoreResult> {
  const category = String(raw.category || '');
  const text = buildSearchableText(raw);
  const result = scoreConstituency(text, category);
  if (result.valid || result.reason !== 'borderline') return result;
  if (!constituencyAiEnabled(useAi))
    return { ...result, reason: 'borderline_no_ai' };
  const decision = await checkBorderlineConstituency(raw, text, fetchImpl);
  if (decision === result.segment)
    return {
      ...result,
      valid: true,
      reason: 'ai_confirmed_segment',
      ai_decision: decision,
    };
  if (decision === 'UNCERTAIN')
    return {
      ...result,
      valid: false,
      reason: 'ai_uncertain',
      ai_decision: decision,
    };
  return {
    ...result,
    valid: false,
    reason: 'ai_other_segment_or_none',
    ai_decision: decision,
  };
}
