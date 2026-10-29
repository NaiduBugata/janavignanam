export const PROBLEM_SENTIMENTS = new Set(['Negative', 'Problem']);
export const HIGH_PRIORITY_CATEGORIES = new Set([
  'Crime',
  'Health',
  'Water',
  'Transport',
  'Roads',
]);

const DEPARTMENT_MAP: Record<string, string> = {
  Transport: 'Roads & Transport (R&B)',
  Roads: 'Roads & Transport (R&B)',
  Infrastructure: 'Infrastructure & Works',
  Health: 'Health & Medical Services',
  Water: 'Rural Water Supply',
  Employment: 'Labour & Employment',
  Agriculture: 'Agriculture & Cooperation',
  Education: 'School Education',
  Crime: 'Police Department',
  'Social Welfare': 'Social Welfare Department',
  Politics: 'General Administration',
  Other: 'General Administration',
  Others: 'General Administration',
};

const ACTION_MAP: Record<string, string> = {
  Transport:
    'Review road safety measures and coordinate with transport authorities for immediate remediation.',
  Roads:
    'Inspect affected road sections and initiate repair or maintenance work.',
  Infrastructure:
    'Assess infrastructure damage and escalate to the relevant engineering department.',
  Health:
    'Coordinate with district health officials to address the reported health concern.',
  Water:
    'Direct the water supply department to investigate and restore services.',
  Employment:
    'Engage with the labour department and employer representatives to resolve the dispute.',
  Agriculture:
    'Connect farmers with agriculture extension officers for support and guidance.',
  Education:
    'Follow up with education department officials regarding the reported issue.',
  Crime:
    'Bring to the attention of local police and district administration for prompt action.',
  'Social Welfare':
    'Coordinate with social welfare officers to ensure beneficiary support.',
  Politics:
    'Monitor the situation and engage with local representatives as needed.',
  Other:
    'Review the matter and assign to the appropriate department for follow-up.',
  Others:
    'Review the matter and assign to the appropriate department for follow-up.',
};

const PRIORITY_ORDER: Record<string, number> = { High: 0, Medium: 1, Low: 2 };

export const CATEGORY_ORDER = [
  'Transport',
  'Employment',
  'Agriculture',
  'Education',
  'Health',
  'Roads',
  'Infrastructure',
  'Politics',
  'Water',
  'Crime',
  'Others',
];

export const MAX_ACTION_ITEMS = 10;
export const MAX_POSITIVE_ITEMS = 10;
export const MAX_KEYWORDS = 15;
export const MAX_ENTITIES = 15;
export const TOP_LOCATIONS = 5;

export interface ReportLocation {
  district: string | null;
  mandal: string | null;
  village: string | null;
  town: string | null;
  state: string;
}

export interface ReportArticle {
  id: string;
  post_id?: unknown;
  title: string;
  summary: string;
  category: string;
  subcategory: string;
  sentiment: string;
  location: ReportLocation;
  keywords: string[];
  entities: unknown[];
  problem?: unknown;
  problem_id?: unknown;
  source_url: string;
  source: string;
  channel: string;
  created_on: string;
  is_problem?: boolean;
  priority?: string;
  department?: string;
  recommended_action?: string;
  problem_summary?: string;
  created_dt?: Date | null;
}

export interface NamedCount {
  name: string;
  count: number;
}

export interface ReportStats {
  total: number;
  positive: number;
  negative: number;
  statement: number;
  neutral: number;
  problems: number;
  high_priority_problems: number;
  districts_covered: number;
  mandals_covered: number;
  villages_covered: number;
  sentiment_counts: Record<string, number>;
  category_counts: Record<string, number>;
  category_summary: NamedCount[];
  sentiment_pct: Record<string, number>;
  most_affected_district: string;
  most_affected_mandal: string;
  most_affected_village: string;
  top_mandals: NamedCount[];
  top_villages: NamedCount[];
  top_keywords: NamedCount[];
  top_entities: NamedCount[];
  action_items: ReportArticle[];
  positive_items: ReportArticle[];
  most_common_category: string;
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const MONTHS_SHORT = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

export function reportTimezone(): string {
  return process.env.REPORT_TIMEZONE || 'Asia/Kolkata';
}

export function constituencyName(): string {
  return process.env.REPORT_CONSTITUENCY || 'Narasaraopet';
}

export function calendarDay(value: Date, timeZone = reportTimezone()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(value);
}

export function previousReportDay(
  now = new Date(),
  timeZone = reportTimezone(),
): string {
  const [year, month, day] = calendarDay(now, timeZone).split('-').map(Number);
  const utc = new Date(Date.UTC(year, month - 1, day));
  utc.setUTCDate(utc.getUTCDate() - 1);
  return utc.toISOString().slice(0, 10);
}

export function formatLongDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-').map(Number);
  return `${String(day).padStart(2, '0')} ${MONTHS[month - 1]} ${year}`;
}

export function zoneParts(
  value: Date,
  timeZone = reportTimezone(),
): { day: string; month: string; year: string; hour: string; minute: string } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(value);
  const pick = (type: string) =>
    parts.find((part) => part.type === type)?.value || '';
  return {
    day: pick('day'),
    month: pick('month'),
    year: pick('year'),
    hour: pick('hour'),
    minute: pick('minute'),
  };
}

export function formatGeneratedAt(
  value: Date,
  timeZone = reportTimezone(),
): string {
  const parts = zoneParts(value, timeZone);
  const hour = Number(parts.hour);
  const suffix = hour >= 12 ? 'PM' : 'AM';
  const twelve = hour % 12 || 12;
  return `${parts.day} ${MONTHS_SHORT[Number(parts.month) - 1]} ${parts.year}, ${String(twelve).padStart(2, '0')}:${parts.minute} ${suffix} IST`;
}

export function parseCreatedOn(
  value: string,
  timeZone = reportTimezone(),
): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  if (!/[zZ]|[+-]\d{2}:?\d{2}$/.test(value)) {
    const parts = zoneParts(parsed, timeZone);
    return new Date(
      `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:00+05:30`,
    );
  }
  return parsed;
}

export function normalizeArticle(doc: Record<string, unknown>): ReportArticle {
  const location =
    doc.location &&
    typeof doc.location === 'object' &&
    !Array.isArray(doc.location)
      ? (doc.location as Record<string, unknown>)
      : {};
  return {
    id: String(doc._id || ''),
    post_id: doc.post_id,
    title: String(doc.title || ''),
    summary: String(doc.summary || ''),
    category: String(doc.category || 'Others'),
    subcategory: String(doc.subcategory || ''),
    sentiment: String(doc.sentiment || ''),
    location: {
      district: location.district ? String(location.district) : null,
      mandal: location.mandal ? String(location.mandal) : null,
      village: location.village ? String(location.village) : null,
      town: location.town ? String(location.town) : null,
      state: location.state ? String(location.state) : 'Andhra Pradesh',
    },
    keywords: Array.isArray(doc.keywords) ? doc.keywords.map(String) : [],
    entities: Array.isArray(doc.entities) ? doc.entities : [],
    problem: doc.problem,
    problem_id: doc.problem_id,
    source_url: String(doc.source_url || ''),
    source: String(doc.source || 'lokal'),
    channel: String(doc.channel || ''),
    created_on: String(doc.created_on || ''),
  };
}

export function isProblem(article: ReportArticle): boolean {
  return PROBLEM_SENTIMENTS.has(article.sentiment || '');
}

export function enrichArticle(article: ReportArticle): ReportArticle {
  const category = article.category || 'Other';
  const problem = isProblem(article);
  return {
    ...article,
    is_problem: problem,
    priority: !problem
      ? 'Low'
      : HIGH_PRIORITY_CATEGORIES.has(article.category)
        ? 'High'
        : 'Medium',
    department: DEPARTMENT_MAP[category] || DEPARTMENT_MAP.Other,
    recommended_action: ACTION_MAP[category] || ACTION_MAP.Other,
    problem_summary: article.problem
      ? String(article.problem)
      : problem
        ? article.summary || ''
        : '',
    created_dt: parseCreatedOn(article.created_on),
  };
}

export function articlesForDay(
  docs: Array<Record<string, unknown>>,
  target: string,
): ReportArticle[] {
  const enriched = docs
    .map((doc) => enrichArticle(normalizeArticle(doc)))
    .filter(
      (article) =>
        article.created_dt && calendarDay(article.created_dt) === target,
    );
  enriched.sort(
    (a, b) => (b.created_dt?.getTime() || 0) - (a.created_dt?.getTime() || 0),
  );
  return enriched;
}

export function formatLocation(location: ReportLocation | undefined): string {
  if (!location) return 'Not specified';
  const parts = [
    location.village,
    location.town,
    location.mandal,
    location.district,
  ].filter(Boolean);
  return parts.length ? parts.join(', ') : 'Not specified';
}

function countBy(
  items: ReportArticle[],
  getter: (article: ReportArticle) => string | null | undefined,
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const key = getter(item);
    if (!key) continue;
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function topCounts(
  counts: Record<string, number>,
  limit: number,
): NamedCount[] {
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([name, count]) => ({ name, count }));
}

function most(counts: Record<string, number>): string {
  const ranked = topCounts(counts, 1);
  return ranked[0]?.name || 'None';
}

export function computeStats(articles: ReportArticle[]): ReportStats {
  const total = articles.length;
  const sentimentCounts = countBy(
    articles,
    (article) => article.sentiment || 'Unknown',
  );
  const categoryCounts = countBy(
    articles,
    (article) => article.category || 'Others',
  );
  const districtCounts = countBy(
    articles,
    (article) => article.location?.district,
  );
  const mandalCounts = countBy(articles, (article) => article.location?.mandal);
  const villageCounts = countBy(
    articles,
    (article) => article.location?.village,
  );
  const problems = articles.filter((article) => article.is_problem);
  const positives = articles.filter(
    (article) => article.sentiment === 'Positive',
  );
  const keywords: Record<string, number> = {};
  const entities: Record<string, number> = {};
  for (const article of articles) {
    for (const keyword of article.keywords || []) {
      if (keyword)
        keywords[String(keyword)] = (keywords[String(keyword)] || 0) + 1;
    }
    for (const entity of article.entities || []) {
      const name =
        entity &&
        typeof entity === 'object' &&
        'name' in (entity as Record<string, unknown>)
          ? String((entity as { name?: unknown }).name || '')
          : String(entity || '');
      if (name) entities[name] = (entities[name] || 0) + 1;
    }
  }
  const positive = sentimentCounts.Positive || 0;
  const negative = sentimentCounts.Negative || 0;
  const statement = sentimentCounts.Statement || 0;
  const neutral = sentimentCounts.Neutral || 0;
  const pct = (value: number) =>
    total ? Math.round((value / total) * 1000) / 10 : 0;
  const known = new Set(CATEGORY_ORDER.filter((name) => name !== 'Others'));
  const categorySummary = CATEGORY_ORDER.map((name) => ({
    name,
    count:
      name === 'Others'
        ? Object.entries(categoryCounts)
            .filter(([key]) => !known.has(key))
            .reduce((sum, [, count]) => sum + count, 0)
        : categoryCounts[name] || 0,
  }));
  const actionItems = [...problems].sort((a, b) => {
    const priority =
      (PRIORITY_ORDER[a.priority || ''] ?? 3) -
      (PRIORITY_ORDER[b.priority || ''] ?? 3);
    if (priority) return priority;
    return (b.created_dt?.getTime() || 0) - (a.created_dt?.getTime() || 0);
  });
  return {
    total,
    positive,
    negative,
    statement,
    neutral,
    problems: problems.length,
    high_priority_problems: problems.filter(
      (article) => article.priority === 'High',
    ).length,
    districts_covered: Object.keys(districtCounts).length,
    mandals_covered: Object.keys(mandalCounts).length,
    villages_covered: Object.keys(villageCounts).length,
    sentiment_counts: sentimentCounts,
    category_counts: categoryCounts,
    category_summary: categorySummary,
    sentiment_pct: {
      Positive: pct(positive),
      Negative: pct(negative),
      Statement: pct(statement),
      Neutral: pct(neutral),
    },
    most_affected_district: most(districtCounts),
    most_affected_mandal: most(mandalCounts),
    most_affected_village: most(villageCounts),
    top_mandals: topCounts(mandalCounts, TOP_LOCATIONS),
    top_villages: topCounts(villageCounts, TOP_LOCATIONS),
    top_keywords: topCounts(keywords, MAX_KEYWORDS),
    top_entities: topCounts(entities, MAX_ENTITIES),
    action_items: actionItems.slice(0, MAX_ACTION_ITEMS),
    positive_items: positives.slice(0, MAX_POSITIVE_ITEMS),
    most_common_category: most(categoryCounts),
  };
}
