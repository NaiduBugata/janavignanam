import 'reflect-metadata';
import { buildBriefing } from './one-page-briefing';
import { briefingPdf } from './progress-report';

describe('one page briefing', () => {
  it('counts news problems, grievance progress, and benefits', () => {
    const briefing = buildBriefing({
      generatedOn: '2026-11-06',
      news: {
        articles: 10,
        problemsCollected: 4,
        byCategory: [
          { name: 'Roads', count: 3 },
          { name: 'Water', count: 1 },
        ],
      },
      grievances: [
        { status: 'Pending', categories: ['Roads & Infrastructure'] },
        { status: 'In progress', categories: ['Roads & Infrastructure'], progressHistory: [{ status: 'Approved' }] },
        { status: 'Completed', categories: ['Water'], progressHistory: [{ status: 'Approved' }] },
        { status: 'Approved', categories: ['Housing'] },
      ],
      events: [
        { status: 'CMRF / Medical Assistance' },
        { status: 'Housing' },
        { status: 'CMRF / Medical Assistance' },
      ],
    });

    expect(briefing.news.problemsCollected).toBe(4);
    expect(briefing.grievances.total).toBe(4);
    expect(briefing.grievances.pending).toBe(2);
    expect(briefing.grievances.inProgress).toBe(1);
    expect(briefing.grievances.completed).toBe(1);
    expect(briefing.grievances.notApproved).toBe(1);
    expect(briefing.grievances.byCategory[0]).toMatchObject({
      name: 'Roads & Infrastructure',
      count: 2,
      pending: 1,
      inProgress: 1,
      notApproved: 1,
    });
    expect(briefing.benefits.people).toBe(3);
    expect(briefing.benefits.byKind.find((row) => row.name === 'CMRF / Medical Assistance')?.count).toBe(2);

    const pdf = briefingPdf(briefing);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    const pages = pdf.toString('latin1').match(/\/Type \/Page(?!s)/g) || [];
    expect(pages.length).toBeGreaterThan(0);
    expect(pages.length).toBeLessThanOrEqual(2);
  });
});
