import { discoverGroqApiKeys, GroqKeyRotator } from './groq-keys';
import { repairJson } from '../pipeline/native/json-repair';
import { problemId } from '../pipeline/native/problem-id';
import { qualityScore } from '../pipeline/native/quality';
import {
  ALLOWED_CATEGORIES,
  cleanSummary,
  englishFraction,
  normalizeCategory,
  normalizeConfidence,
  normalizeDistrict,
  normalizeEntities,
  normalizeKeywords,
  normalizeLocation,
  normalizePeople,
  normalizeSentiment,
  normalizeSubcategory,
  normalizeWhitespace,
  wordCount,
} from './groq-normalizer';

const CLASSIFICATION_PROMPT =
  'Analyze this single OCR article and return JSON only.\nTITLE: {title}\nCONTENT: {content}\nReturn exactly this shape: {"sentiment":"","category":"","subcategory":"","problem":"","severity":"","authority":""}.';
const EXTRACTION_PROMPT =
  'Analyze this single OCR article and return JSON only.\nTITLE: {title}\nCONTENT: {content}\nReturn exactly this shape: {"location":{"village":"","town":"","mandal":"","district":"","state":"Andhra Pradesh"},"people":[],"entities":[],"keywords":[]}.';
const SUMMARY_PROMPT =
  'Write a complete summary of this single news article and return JSON only.\n' +
  'Finish the story in complete sentences. Do not stop mid-sentence and do not end with an ellipsis.\n' +
  'Use 45 to 65 words.\n' +
  'TITLE: {title}\nCONTENT: {content}\nReturn exactly this shape: {"summary":""}.';

const ENTITY_PATTERNS: Array<[string, RegExp]> = [
  [
    'Organization',
    /(\S+(?:\s+\S+){0,4}(?:కార్యాలయం|యూనియన్|సంఘం|కళాశాల|పాఠశాల|డివిజన్|శాఖ|కమిటీ|విభాగం|పార్టీ|మండలి|సమాఖ్య|సంస్థ))/g,
  ],
  [
    'Department',
    /(\S+(?:\s+\S+){0,3}(?:విభాగం|శాఖ|కార్యాలయం|అధికారులు|సిబ్బంది))/g,
  ],
  ['Political Party', /(వైసీపీ|టిడిపి|బీజేపీ|కాంగ్రెస్|జనసేన|సీపీఎం|సీపీఐ)/g],
  [
    'Scheme',
    /(మన బడి[–-]మన భవిష్యత్తు|అమృత్ భారత్ స్టేషన్ పథకం|పీఆర్సీ|ప్రజా సమస్యల పరిష్కార వేదిక)/g,
  ],
];

export interface ArticleToAnalyze {
  articleId: string;
  title: string;
  content: string;
}

export interface ValidationResult {
  severity: string;
  field: string;
  message: string;
  repaired: boolean;
  continue_processing: boolean;
}

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  const parsed = Number(raw);
  return raw && Number.isFinite(parsed) ? parsed : fallback;
}

function parseModelJson(raw: string): Record<string, unknown> {
  try {
    return repairJson(raw);
  } catch {
    const stripped = raw.replace(/,(?=\s*[}\]])/g, '');
    return repairJson(stripped);
  }
}

function isRetryable(message: string): boolean {
  const text = message.toLowerCase();
  return [
    '429',
    'rate limit',
    'quota',
    'timeout',
    'timed out',
    'network',
    'connection',
    'unavailable',
    '502',
    '503',
    '504',
  ].some((term) => text.includes(term));
}

function mergeStages(
  stage1: Record<string, unknown>,
  stage2: Record<string, unknown>,
  stage3: Record<string, unknown>,
  title: string,
): Record<string, unknown> {
  const sentiment = normalizeSentiment(stage1.sentiment);
  const summary = cleanSummary(stage3.summary, title);
  return {
    title: normalizeWhitespace(title),
    sentiment,
    category: normalizeCategory(stage1.category),
    subcategory: normalizeSubcategory(
      stage1.subcategory || stage1.problem || stage1.category,
    ),
    problem:
      sentiment === 'Problem'
        ? normalizeWhitespace(stage1.problem) || null
        : null,
    problem_id: null,
    trend_id: null,
    severity: normalizeWhitespace(stage1.severity),
    authority: normalizeWhitespace(stage1.authority),
    location: normalizeLocation(stage2.location),
    people: normalizePeople(stage2.people),
    entities: normalizeEntities(stage2.entities),
    summary,
    keywords: normalizeKeywords(stage2.keywords),
    confidence: normalizeConfidence(stage1.confidence),
    quality_score: 0,
  };
}

function decideAnalysis(
  results: ValidationResult[],
  retriesRemaining: number,
): 'accept' | 'retry' | 'reject' {
  if (results.some((item) => item.severity === 'CRITICAL')) return 'reject';
  if (results.some((item) => item.severity === 'ERROR' && !item.repaired)) {
    return retriesRemaining > 0 ? 'retry' : 'reject';
  }
  return 'accept';
}

export function validateAnalysis(
  analysis: Record<string, unknown>,
): ValidationResult[] {
  const results: ValidationResult[] = [];
  const result = (
    severity: string,
    field: string,
    message: string,
    repaired: boolean,
    continueProcessing: boolean,
  ): ValidationResult => ({
    severity,
    field,
    message,
    repaired,
    continue_processing: continueProcessing,
  });

  if (!analysis.title)
    return [result('CRITICAL', 'title', 'Missing title', false, false)];
  if (!analysis.summary)
    return [result('CRITICAL', 'summary', 'Missing summary', false, false)];
  if (!analysis.sentiment)
    return [result('CRITICAL', 'sentiment', 'Missing sentiment', false, false)];

  const sentiment = String(analysis.sentiment);
  if (!['Problem', 'Positive', 'Negative', 'Statement'].includes(sentiment)) {
    const fixed = normalizeSentiment(sentiment);
    if (['Problem', 'Positive', 'Negative', 'Statement'].includes(fixed)) {
      analysis.sentiment = fixed;
      results.push(
        result(
          'INFO',
          'sentiment',
          `Normalized sentiment ${sentiment} -> ${fixed}`,
          true,
          true,
        ),
      );
    } else {
      results.push(
        result(
          'ERROR',
          'sentiment',
          `Unknown sentiment: ${sentiment}`,
          false,
          false,
        ),
      );
    }
  }

  const category = String(analysis.category || '');
  if (
    category &&
    !ALLOWED_CATEGORIES.includes(
      category as (typeof ALLOWED_CATEGORIES)[number],
    )
  ) {
    const fixed = normalizeCategory(category);
    analysis.category = ALLOWED_CATEGORIES.includes(
      fixed as (typeof ALLOWED_CATEGORIES)[number],
    )
      ? fixed
      : 'Other';
    results.push(
      result(
        'INFO',
        'category',
        `Normalized category ${category} -> ${analysis.category}`,
        true,
        true,
      ),
    );
  }

  const words = wordCount(String(analysis.summary || ''));
  if (words < 45 || words > 65) {
    results.push(
      result(
        'WARNING',
        'summary',
        `Summary length ${words} outside preferred 45-65`,
        false,
        true,
      ),
    );
  }
  const fraction = englishFraction(String(analysis.summary || ''));
  if (fraction > 0.2) {
    results.push(
      result(
        'WARNING',
        'summary',
        `English fraction ${fraction.toFixed(2)} > 0.20`,
        false,
        true,
      ),
    );
  }
  const confidence = analysis.confidence;
  if (typeof confidence === 'number' && confidence < 0.5) {
    results.push(
      result(
        'WARNING',
        'confidence',
        `Low confidence: ${confidence}`,
        false,
        true,
      ),
    );
  }
  return results;
}

export function extractEntities(
  title: string,
  content: string,
  analysis: Record<string, unknown>,
): Array<{ type: string; name: string; normalized: string }> {
  const entities: Array<{ type: string; name: string; normalized: string }> =
    [];
  const seen = new Set<string>();
  const add = (type: string, name: string) => {
    const cleaned = normalizeWhitespace(name);
    if (!cleaned) return;
    const normalized = cleaned
      .toLowerCase()
      .replace(/[\s\-–—,.;:!?()[\]{}'"“”‘’।]+/g, '');
    const key = `${type}|${normalized}`;
    if (!normalized || seen.has(key)) return;
    seen.add(key);
    entities.push({ type, name: cleaned, normalized });
  };
  for (const person of (analysis.people as Array<{ name?: string }>) || [])
    add('Person', person.name || '');
  const location = (analysis.location || {}) as Record<string, string | null>;
  for (const key of [
    'village',
    'village_telugu',
    'mandal',
    'mandal_telugu',
    'district',
    'district_telugu',
  ]) {
    const value = location[key];
    if (!value) continue;
    const label = key.includes('district')
      ? 'District'
      : key.includes('mandal')
        ? 'Mandal'
        : 'Village';
    add(label, value);
  }
  const text = `${title}\n${content}\n${analysis.summary || ''}`;
  for (const [type, pattern] of ENTITY_PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) add(type, match[1] || match[0]);
  }
  for (const name of text.match(/(?:[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})/g) ||
    []) {
    if (entities.filter((item) => item.type === 'Person').length >= 20) break;
    add('Person', name);
  }
  return entities;
}

async function runStage(
  rotator: GroqKeyRotator,
  keys: string[],
  stage: string,
  template: string,
  title: string,
  content: string,
  fetchImpl: typeof fetch,
): Promise<Record<string, unknown>> {
  const maxRetries = intEnv('MAX_RETRIES', 5);
  let lastError = `${stage} stage failed`;
  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    const index = rotator.acquire();
    if (index == null) throw new Error(`groq_all_keys_cooling:${stage}`);
    const key = keys[index - 1];
    const user = template
      .replace('{title}', title)
      .replace('{content}', content);
    try {
      const response = await fetchImpl(
        'https://api.groq.com/openai/v1/chat/completions',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${key}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: process.env.GROQ_MODEL || 'openai/gpt-oss-120b',
            temperature: Number(process.env.GROQ_TEMPERATURE || '0'),
            messages: [
              {
                role: 'system',
                content: `You are the ${stage} engine for Telugu news analysis. Return ONLY valid JSON.`,
              },
              { role: 'user', content: user },
            ],
          }),
          signal: AbortSignal.timeout(
            intEnv('GROQ_TIMEOUT_SECONDS', 120) * 1000,
          ),
        },
      );
      if (!response.ok) {
        const message = `HTTP ${response.status}`;
        if (isRetryable(message) && attempt < maxRetries) {
          rotator.coolDown(index);
          lastError = message;
          continue;
        }
        throw new Error(message);
      }
      const body = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const raw = body.choices?.[0]?.message?.content || '';
      if (!raw.trim()) throw new Error(`groq_empty:${stage}`);
      const parsed = parseModelJson(raw);
      if (stage === 'summary' && !cleanSummary(parsed.summary, title)) {
        throw new Error('Summary stage returned empty summary');
      }
      return parsed;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      lastError = message;
      if (!isRetryable(message) && stage !== 'summary') throw err;
      if (attempt >= maxRetries) throw err;
      rotator.coolDown(index);
    }
  }
  throw new Error(lastError);
}

/**
 * One article through the Python Groq analyzer path:
 * three stages, normalize, validate, decide, quality score, problem id.
 */
export async function analyzeNewsArticle(
  article: ArticleToAnalyze,
  fetchImpl: typeof fetch = fetch,
): Promise<Record<string, unknown>> {
  const keys = discoverGroqApiKeys();
  if (!keys.length) throw new Error('no_groq_keys');
  const minChars = intEnv('EMPTY_ARTICLE_MIN_CHARS', 25);
  if (!article.title.trim() && !article.content.trim())
    throw new Error('empty_article');
  if (article.content.trim().length < minChars)
    throw new Error('short_article');

  const rotator = new GroqKeyRotator(
    keys,
    Number(process.env.COOLDOWN_SECONDS || '60'),
  );
  const title = article.title.slice(0, 500);
  const content = article.content.slice(0, 4000);
  let retriesRemaining = Math.min(1, Math.max(0, intEnv('MAX_RETRIES', 5)));

  while (true) {
    const stage1 = await runStage(
      rotator,
      keys,
      'classification',
      CLASSIFICATION_PROMPT,
      title,
      content,
      fetchImpl,
    );
    const stage2 = await runStage(
      rotator,
      keys,
      'extraction',
      EXTRACTION_PROMPT,
      title,
      content,
      fetchImpl,
    );
    const stage3 = await runStage(
      rotator,
      keys,
      'summary',
      SUMMARY_PROMPT,
      title,
      content,
      fetchImpl,
    );
    const analysis = mergeStages(stage1, stage2, stage3, title);
    const district = String(
      (analysis.location as { district?: string }).district || '',
    );
    if (analysis.sentiment === 'Problem') {
      analysis.problem_id = problemId(
        String(analysis.category || ''),
        district,
        String(analysis.problem || ''),
      );
    }
    analysis.entities = extractEntities(title, content, analysis);
    analysis.article_id = article.articleId;
    const validation = validateAnalysis(analysis);
    const decision = decideAnalysis(validation, retriesRemaining);
    if (decision === 'accept') {
      analysis.quality_score = qualityScore(
        analysis,
        validation.filter((item) => item.repaired).length,
      );
      analysis.district = normalizeDistrict(district);
      return analysis;
    }
    if (decision === 'retry' && retriesRemaining > 0) {
      retriesRemaining -= 1;
      continue;
    }
    throw new Error('decision_reject');
  }
}
