/** Normalizers from ai/telugu_ai_news_analyzer.py. */

export const ALLOWED_SENTIMENTS = [
  'Problem',
  'Positive',
  'Negative',
  'Statement',
] as const;

export const ALLOWED_CATEGORIES = [
  'Roads',
  'Drainage',
  'Water',
  'Electricity',
  'Agriculture',
  'Health',
  'Education',
  'Employment',
  'Government',
  'Politics',
  'Crime',
  'Court',
  'Revenue',
  'Transport',
  'Environment',
  'Weather',
  'Business',
  'Economy',
  'Sports',
  'Entertainment',
  'Religion',
  'Technology',
  'Social Welfare',
  'Infrastructure',
  'Public Grievance',
  'Tourism',
  'Other',
] as const;

const CATEGORY_MATCHES: Array<[string, string]> = [
  ['roads', 'Roads'],
  ['road', 'Roads'],
  ['drainage', 'Drainage'],
  ['water', 'Water'],
  ['electricity', 'Electricity'],
  ['power', 'Electricity'],
  ['agriculture', 'Agriculture'],
  ['health', 'Health'],
  ['education', 'Education'],
  ['educational', 'Education'],
  ['school', 'Education'],
  ['college', 'Education'],
  ['విద్య', 'Education'],
  ['employment', 'Employment'],
  ['employ', 'Employment'],
  ['job', 'Employment'],
  ['labor', 'Employment'],
  ['labour', 'Employment'],
  ['jobs', 'Employment'],
  ['government', 'Government'],
  ['governance', 'Government'],
  ['administration', 'Government'],
  ['politics', 'Politics'],
  ['election', 'Politics'],
  ['crime', 'Crime'],
  ['court', 'Court'],
  ['revenue', 'Revenue'],
  ['transport', 'Transport'],
  ['rail', 'Transport'],
  ['environment', 'Environment'],
  ['weather', 'Weather'],
  ['business', 'Business'],
  ['economy', 'Economy'],
  ['sports', 'Sports'],
  ['entertainment', 'Entertainment'],
  ['culture', 'Other'],
  ['festival', 'Religion'],
  ['religion', 'Religion'],
  ['technology', 'Technology'],
  ['social welfare', 'Social Welfare'],
  ['welfare', 'Social Welfare'],
  ['infrastructure', 'Infrastructure'],
  ['grievance', 'Public Grievance'],
  ['tourism', 'Tourism'],
  ['accident', 'Transport'],
  ['accidents', 'Transport'],
  ['ప్రమాదం', 'Transport'],
  ['social', 'Social Welfare'],
  ['society', 'Social Welfare'],
  ['fire', 'Other'],
];

const DISTRICT_ALIASES: Record<string, string> = {
  guntur: 'Guntur',
  గుంటూరు: 'Guntur',
  'guntur జిల్లా': 'Guntur',
  'గుంటూరు జిల్లా': 'Guntur',
  palnadu: 'Palnadu',
  పల్నాడు: 'Palnadu',
  'palnadu జిల్లా': 'Palnadu',
  'పల్నాడు జిల్లా': 'Palnadu',
  narasaraopet: 'Palnadu',
  నరసరావుపేట: 'Palnadu',
};

const INVISIBLE = /[\u200B\u200C\u200D\uFEFF\u2060\u00AD]/g;

export function normalizeWhitespace(value: unknown): string {
  if (value == null) return '';
  return String(value)
    .normalize('NFKC')
    .replace(INVISIBLE, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function wordCount(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

export function normalizeCategory(value: unknown): string {
  const text = normalizeWhitespace(value);
  if (!text) return 'Other';
  if (['news', 'వార్త', 'announcement', 'meeting'].includes(text.toLowerCase()))
    return 'Other';
  const compact = text.toLowerCase().replace(/[^a-z0-9\u0C00-\u0C7F]+/g, '');
  const direct = ALLOWED_CATEGORIES.find(
    (item) => item.toLowerCase().replace(/[^a-z0-9]+/g, '') === compact,
  );
  if (direct) return direct;
  const normalized = text
    .toLowerCase()
    .replace(/[^\w\u0C00-\u0C7F]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  for (const [token, category] of CATEGORY_MATCHES) {
    if (normalized.includes(token) || compact.includes(token.replace(/ /g, '')))
      return category;
  }
  const fuzzy = closeCategory(text.toLowerCase());
  return fuzzy || 'Other';
}

/** difflib.get_close_matches ratio, cutoff 0.78, against allowed category names. */
function closeCategory(needle: string): string | null {
  let best: { score: number; value: string } | null = null;
  for (const choice of ALLOWED_CATEGORIES) {
    const score = sequenceRatio(needle, choice.toLowerCase());
    if (score >= 0.78 && (!best || score > best.score))
      best = { score, value: choice };
  }
  return best?.value ?? null;
}

function sequenceRatio(a: string, b: string): number {
  if (a === b) return 1;
  const m = a.length;
  const n = b.length;
  if (!m || !n) return 0;
  const prev = new Array<number>(n + 1).fill(0);
  const cur = new Array<number>(n + 1).fill(0);
  for (let i = 1; i <= m; i += 1) {
    cur[0] = 0;
    for (let j = 1; j <= n; j += 1) {
      cur[j] =
        a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
    }
    for (let j = 0; j <= n; j += 1) prev[j] = cur[j];
  }
  return (2 * prev[n]) / (m + n);
}

export function normalizeSubcategory(value: unknown): string {
  return normalizeWhitespace(value)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .join(' ');
}

export function normalizeDistrict(value: unknown): string {
  const text = normalizeWhitespace(value);
  if (!text) return '';
  const key = text
    .toLowerCase()
    .replace(/[^\w\u0C00-\u0C7F]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (DISTRICT_ALIASES[key]) return DISTRICT_ALIASES[key];
  const compact = key.replace(/[^\w\u0C00-\u0C7F]+/g, '');
  if (DISTRICT_ALIASES[compact]) return DISTRICT_ALIASES[compact];
  if (/[A-Za-z]/.test(text))
    return text[0].toUpperCase() + text.slice(1).toLowerCase();
  return text;
}

export function normalizeLocation(
  value: unknown,
): Record<string, string | null> {
  const location =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const districtTelugu =
    normalizeWhitespace(location.district_telugu || location.district) || null;
  const mandalTelugu =
    normalizeWhitespace(location.mandal_telugu || location.mandal) || null;
  const villageTelugu =
    normalizeWhitespace(location.village_telugu || location.village) || null;
  const townTelugu =
    normalizeWhitespace(location.town_telugu || location.town) || null;
  const town = normalizeWhitespace(location.town) || null;
  return {
    village_telugu: villageTelugu,
    village: villageTelugu,
    town_telugu: townTelugu,
    town,
    mandal_telugu: mandalTelugu,
    mandal: normalizeDistrict(location.mandal || mandalTelugu) || null,
    district_telugu: districtTelugu,
    district: normalizeDistrict(location.district || districtTelugu) || null,
    state_telugu:
      normalizeWhitespace(location.state_telugu || 'ఆంధ్రప్రదేశ్') || null,
    state: 'Andhra Pradesh',
  };
}

export function cleanSummary(summary: unknown, title = ''): string {
  if (summary == null) return '';
  let text = String(summary).normalize('NFKC');
  text = text.replace(/(^|\n)\s*([-*+]\s+)|[`*_]{1,3}|^#{1,6}\s+/gm, ' ');
  text = text.replace(/^\s*[-*•]\s+/gm, ' ');
  text = text.replace(/\s+/g, ' ').trim();
  const words: string[] = [];
  let last = '';
  for (const word of text.split(' ')) {
    if (word === last) continue;
    words.push(word);
    last = word;
  }
  text = words.join(' ');
  const normalizedTitle = normalizeWhitespace(title);
  if (normalizedTitle && text.startsWith(normalizedTitle))
    text = text.slice(normalizedTitle.length).trim();
  return text;
}

export function englishFraction(text: string): number {
  const words = text.match(/\w+/g) || [];
  if (!words.length) return 0;
  let english = 0;
  for (const word of words) {
    if (
      /\b(NEET|JEE|AICTE|IIT|NIT|SSC|CBSE|UPSC|IAS|IPS|GPS|COVID-19)\b/i.test(
        word,
      )
    )
      continue;
    if (/[\u0C00-\u0C7F]/.test(word) || /^[0-9-]+$/.test(word)) continue;
    if (/[A-Za-z]/.test(word)) english += 1;
  }
  return english / words.length;
}

export function normalizeSentiment(value: unknown): string {
  const text = extractSentimentText(value);
  if (!text) return 'Statement';
  const direct = text.toLowerCase();
  if (
    direct === 'problem' ||
    direct === 'positive' ||
    direct === 'negative' ||
    direct === 'statement'
  ) {
    return direct[0].toUpperCase() + direct.slice(1);
  }
  const aliases: Array<[RegExp, string]> = [
    [
      /\b(problem|issue|complaint|grievance|pothole|road\s*issue|road\s*damage|water\s*problem|water\s*issue|electricity\s*(issue|cut)|drainage|flood|damage|shortage|repair|public\s*issue|పోటు|ఫిర్యాదు|గర్భ)\b/iu,
      'Problem',
    ],
    [
      /\b(crime|criminal|murder|theft|fraud|robbery|assault|attack|rape|drug|drugs|corruption|bribe|bribery|violence|accident|death|మరణాలు|హత్య|అత్యాచారం|చోరీ|మోసం)\b/iu,
      'Negative',
    ],
    [
      /\b(positive|appreciation|praise|success|achievement|relief|support|approval|approved|inauguration|launch|felicitation|award|congratulation|good\s*news|ప్రశంస|విజయం|అభినందన|వికాసం|సాఫల్య)\b/iu,
      'Positive',
    ],
    [
      /\b(news|announcement|meeting|report|event|update|briefing|inspection|press\s*meet|press\s*conference|వార్త|ప్రకటన|సమావేశం|కార్యక్రమం|రిపోర్ట్|ఇన్స్పెక్షన్|స్ధితి|స్టాటస్)\b/iu,
      'Statement',
    ],
    [/వార్త|ప్రకటన|సమావేశం|చెప్పారు|పత్రిక/, 'Statement'],
    [/రహదారి|రోడ్|రహదారులు/, 'Problem'],
    [/అవార్డు|పురస్కారం|ఇనాగ్యురేషన్|ప్రారంభం/, 'Positive'],
  ];
  for (const [pattern, sentiment] of aliases) {
    if (pattern.test(text)) return sentiment;
  }
  return 'Statement';
}

function extractSentimentText(value: unknown): string {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const row = value as Record<string, unknown>;
    for (const key of ['sentiment', 'primary', 'label', 'value']) {
      if (typeof row[key] === 'string' && row[key].trim())
        return normalizeWhitespace(row[key]);
    }
    return '';
  }
  return normalizeWhitespace(value);
}

export function normalizePeople(
  value: unknown,
): Array<{ name: string; designation: string }> {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const people: Array<{ name: string; designation: string }> = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const name = normalizeWhitespace(row.name);
    const designation = normalizeWhitespace(row.designation);
    if (!name && !designation) continue;
    const key = `${name.toLowerCase()}|${designation.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    people.push({ name, designation });
  }
  return people;
}

export function normalizeEntities(
  value: unknown,
): Array<{ type: string; name: string; normalized: string }> {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const entities: Array<{ type: string; name: string; normalized: string }> =
    [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const type = normalizeWhitespace(row.type);
    const name = normalizeWhitespace(row.name);
    const normalized =
      normalizeWhitespace(row.normalized) || name.toLowerCase();
    if (!type || !name) continue;
    const key = `${type.toLowerCase()}|${normalized.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    entities.push({ type, name, normalized });
  }
  return entities;
}

export function normalizeKeywords(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const keywords: string[] = [];
  for (const item of value) {
    const text = normalizeWhitespace(item);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    keywords.push(text);
  }
  return keywords
    .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
    .slice(0, 10);
}

export function normalizeConfidence(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.round(Math.max(0, Math.min(1, parsed)) * 100) / 100;
}
