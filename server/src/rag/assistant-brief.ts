export type AssistantNavigation = {
  path: string;
  label: string;
  auto: boolean;
  sections: string[];
};

export type AssistantFacts = {
  articles: number;
  bySection: Record<string, { total: number; pending: number; inProgress: number; completed: number }>;
};

const PAGES: Array<Omit<AssistantNavigation, 'auto'>> = [
  { path: '/grievances', label: 'Grievances', sections: ['grievances'] },
  { path: '/projects', label: 'Projects & reports', sections: ['projects'] },
  { path: '/news', label: 'News', sections: [] },
  { path: '/people', label: 'Constituency', sections: ['people'] },
  { path: '/campaigns', label: 'Campaigns', sections: ['campaigns'] },
  { path: '/outreach', label: 'Events & Follow ups', sections: ['events', 'followups'] },
  { path: '/schedule', label: 'Schedule', sections: ['schedules', 'visits'] },
  { path: '/analytics', label: 'Analytics', sections: [] },
];

const PAGE_KEYS: Array<{ page: number; key: string }> = [
  { page: 0, key: 'grievances' },
  { page: 0, key: 'grievance' },
  { page: 0, key: 'complaints' },
  { page: 0, key: 'complaint' },
  { page: 1, key: 'projects' },
  { page: 1, key: 'project' },
  { page: 2, key: 'news' },
  { page: 2, key: 'articles' },
  { page: 2, key: 'article' },
  { page: 3, key: 'constituency' },
  { page: 3, key: 'contacts' },
  { page: 3, key: 'contact list' },
  { page: 4, key: 'campaigns' },
  { page: 4, key: 'campaign' },
  { page: 5, key: 'follow ups' },
  { page: 5, key: 'follow up' },
  { page: 5, key: 'followups' },
  { page: 5, key: 'followup' },
  { page: 5, key: 'events' },
  { page: 5, key: 'event' },
  { page: 5, key: 'benefits' },
  { page: 5, key: 'benefit' },
  { page: 5, key: 'cmrf' },
  { page: 6, key: 'schedule' },
  { page: 6, key: 'schedules' },
  { page: 6, key: 'visits' },
  { page: 6, key: 'visit' },
  { page: 7, key: 'analytics' },
  { page: 7, key: 'analysis' },
  { page: 7, key: 'statistics' },
  { page: 7, key: 'stats' },
];

const NAV_INTENT = /\b(go to|open|take me|navigate|move to|switch to)\b/i;
const FACT_INTENT = /\b(how many|how much|what|why|which|when|who|summar|status|pending|progress|list|count)\b/i;

export function assistantGreeting(now = new Date()): string {
  const hour = Number(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Kolkata',
      hour: 'numeric',
      hourCycle: 'h23',
    }).format(now),
  );
  const part = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';
  return `Good ${part}, Sri. Lavu Sri Krishna Devarayalu Sir.`;
}

export function matchAssistantPage(question: string): AssistantNavigation | null {
  const text = question.toLowerCase();
  let best: { index: number; score: number } | null = null;
  for (const entry of PAGE_KEYS) {
    if (!text.includes(entry.key)) continue;
    const score = entry.key.length;
    if (!best || score > best.score) best = { index: entry.page, score };
  }
  if (!best) return null;
  const page = PAGES[best.index];
  const auto = NAV_INTENT.test(question) && !FACT_INTENT.test(question);
  return { ...page, auto };
}

export function buildAssistantSummary(
  question: string,
  sources: Array<{ document_name: string }>,
  facts: AssistantFacts | null,
  page: AssistantNavigation | null,
): string {
  const lines: string[] = [];
  const sectionFacts = page ? sectionLine(facts, page) : '';
  if (sectionFacts) lines.push(sectionFacts);
  else if (facts && /\b(how many|count|total|summary|overview|status)\b/i.test(question)) {
    lines.push(overallLine(facts));
  }

  if (sources.length) {
    const names = sources.slice(0, 3).map((source) => source.document_name).filter(Boolean);
    lines.push(
      names.length
        ? `Closest matches: ${names.join('; ')}.`
        : `${sources.length} saved records match this question.`,
    );
  } else if (!lines.length) {
    lines.push(`No saved record matches "${question.trim()}".`);
  }

  if (page) {
    lines.push(page.auto ? `Opening ${page.label} after this summary.` : `Open ${page.label} for the full list.`);
  }
  return lines.join(' ');
}

function sectionLine(facts: AssistantFacts | null, page: AssistantNavigation): string {
  if (!facts) return '';
  if (!page.sections.length && page.path === '/news') {
    return `News articles saved: ${facts.articles}.`;
  }
  const totals = page.sections.map((section) => facts.bySection[section]).filter(Boolean);
  if (!totals.length) return '';
  const total = totals.reduce((sum, row) => sum + row.total, 0);
  const pending = totals.reduce((sum, row) => sum + row.pending, 0);
  const inProgress = totals.reduce((sum, row) => sum + row.inProgress, 0);
  const completed = totals.reduce((sum, row) => sum + row.completed, 0);
  return `${page.label}: ${total} saved, ${pending} pending, ${inProgress} in progress, ${completed} completed.`;
}

function overallLine(facts: AssistantFacts): string {
  const rows = Object.values(facts.bySection);
  const records = rows.reduce((sum, row) => sum + row.total, 0);
  const pending = rows.reduce((sum, row) => sum + row.pending, 0);
  const completed = rows.reduce((sum, row) => sum + row.completed, 0);
  return `Saved records: ${records}. Pending: ${pending}. Completed: ${completed}. News articles: ${facts.articles}.`;
}

export function emptyFacts(): AssistantFacts {
  return { articles: 0, bySection: {} };
}

export function addFact(facts: AssistantFacts, collection: string, section: string, status: string, count: number): void {
  if (collection === 'articles') {
    facts.articles += count;
    return;
  }
  if (collection !== 'jv_records' || !section) return;
  const row = facts.bySection[section] || { total: 0, pending: 0, inProgress: 0, completed: 0 };
  row.total += count;
  if (status === 'Completed' || status === 'Resolved') row.completed += count;
  else if (status === 'In progress' || status === 'Started' || status === 'Need time') row.inProgress += count;
  else row.pending += count;
  facts.bySection[section] = row;
}
