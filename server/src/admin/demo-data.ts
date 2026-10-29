/** When this is off, mock rows stay stored and are left out of every list. */
let enabled = true;

export function isDemoDataEnabled(): boolean {
  return enabled;
}

export function setDemoDataEnabled(value: boolean): void {
  enabled = value;
}

export function isDemoDoc(row: {
  source?: unknown;
  title?: unknown;
  detail?: unknown;
}): boolean {
  const source = String(row.source || '');
  const title = String(row.title || '');
  const detail = String(row.detail || '');
  return (
    source === 'mock' ||
    title.startsWith('MOCK') ||
    detail.includes('MOCK-VISIT')
  );
}

/** Shown for Projects when the switch is on and that section has no stored rows. */
export const DEMO_PROJECTS: Array<{
  title: string;
  detail: string;
  status: string;
}> = [
  {
    title: 'Drinking water supply',
    detail: 'Narasaraopet municipal pipeline replacement in ward 12.',
    status: 'In progress',
  },
  {
    title: 'Chilakaluripet road',
    detail: 'Widening the market road inside Chilakaluripet.',
    status: 'Open',
  },
  {
    title: 'Vinukonda hospital',
    detail: 'New ward block at the Vinukonda area hospital.',
    status: 'In progress',
  },
  {
    title: 'Sattenapalle classrooms',
    detail: 'Extra classrooms at the government high school.',
    status: 'Open',
  },
  {
    title: 'Gurazala canal',
    detail: 'Repair of the irrigation channel before the crop season.',
    status: 'Open',
  },
  {
    title: 'Macherla health camp report',
    detail: 'Weekly camp report for Macherla mandal.',
    status: 'Open',
  },
];

export function demoProjectDocs(): Array<Record<string, unknown>> {
  return DEMO_PROJECTS.map((item, index) => ({
    _id: `demo-project-${index + 1}`,
    section: 'projects',
    title: item.title,
    detail: item.detail,
    status: item.status,
    source: 'mock',
    createdAt: '2026-10-01T00:00:00.000Z',
    createdBy: 'Sample',
  }));
}
