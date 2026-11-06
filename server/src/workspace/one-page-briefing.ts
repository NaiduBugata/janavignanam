import { BENEFIT_KINDS } from './workspace.dto';

export type CountRow = { name: string; count: number };

export type CategoryRow = CountRow & {
  pending: number;
  inProgress: number;
  completed: number;
  notApproved: number;
};

export type Briefing = {
  generatedOn: string;
  news: {
    articles: number;
    problemsCollected: number;
    byCategory: CountRow[];
  };
  grievances: {
    total: number;
    pending: number;
    inProgress: number;
    completed: number;
    notApproved: number;
    byCategory: CategoryRow[];
  };
  benefits: {
    people: number;
    byKind: CountRow[];
  };
};

type GrievanceSource = {
  status?: string;
  categories?: string[];
  progressHistory?: { status?: string }[];
};

type BenefitSource = {
  status?: string;
  categories?: string[];
};

export function buildBriefing(input: {
  generatedOn: string;
  news: Briefing['news'];
  grievances: GrievanceSource[];
  events: BenefitSource[];
}): Briefing {
  const grievances = emptyGrievances();
  for (const row of input.grievances) {
    const bucket = workBucket(row.status || '');
    const approved = isApproved(row);
    grievances.total += 1;
    grievances[bucket] += 1;
    if (!approved) grievances.notApproved += 1;
    const category = categoryOf(row.categories);
    const found = grievances.byCategory.find((item) => item.name === category);
    const target = found || emptyCategory(category);
    if (!found) grievances.byCategory.push(target);
    target.count += 1;
    target[bucket] += 1;
    if (!approved) target.notApproved += 1;
  }
  grievances.byCategory.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  const benefits = new Map<string, number>(BENEFIT_KINDS.map((kind) => [kind, 0]));
  for (const row of input.events) {
    const kind = benefitOf(row);
    benefits.set(kind, (benefits.get(kind) || 0) + 1);
  }

  return {
    generatedOn: input.generatedOn,
    news: {
      articles: input.news.articles,
      problemsCollected: input.news.problemsCollected,
      byCategory: input.news.byCategory.filter((row) => row.count > 0).slice(0, 8),
    },
    grievances,
    benefits: {
      people: input.events.length,
      byKind: [...benefits.entries()].map(([name, count]) => ({ name, count })),
    },
  };
}

function emptyGrievances(): Briefing['grievances'] {
  return {
    total: 0,
    pending: 0,
    inProgress: 0,
    completed: 0,
    notApproved: 0,
    byCategory: [],
  };
}

function emptyCategory(name: string): CategoryRow {
  return { name, count: 0, pending: 0, inProgress: 0, completed: 0, notApproved: 0 };
}

function categoryOf(categories?: string[]): string {
  const name = (categories || []).map((item) => item.trim()).find(Boolean);
  return name || 'Other';
}

function benefitOf(row: BenefitSource): string {
  const status = (row.status || '').trim();
  if ((BENEFIT_KINDS as readonly string[]).includes(status)) return status;
  const category = (row.categories || []).map((item) => item.trim()).find((item) => (BENEFIT_KINDS as readonly string[]).includes(item));
  return category || 'Other benefit';
}

function workBucket(status: string): 'pending' | 'inProgress' | 'completed' {
  if (status === 'Completed' || status === 'Resolved') return 'completed';
  if (status === 'In progress' || status === 'Started' || status === 'Need time') return 'inProgress';
  return 'pending';
}

function isApproved(row: GrievanceSource): boolean {
  if ((row.status || '') === 'Approved') return true;
  return (row.progressHistory || []).some((entry) => entry.status === 'Approved');
}
