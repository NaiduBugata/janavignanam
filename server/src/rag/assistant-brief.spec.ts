import { assistantGreeting, buildAssistantSummary, matchAssistantPage } from './assistant-brief';

describe('MP assistant brief', () => {
  it('greets by the time in India', () => {
    expect(assistantGreeting(new Date('2026-11-06T02:00:00Z'))).toBe(
      'Good morning, Sri. Lavu Sri Krishna Devarayalu Sir.',
    );
    expect(assistantGreeting(new Date('2026-11-06T08:30:00Z'))).toBe(
      'Good afternoon, Sri. Lavu Sri Krishna Devarayalu Sir.',
    );
    expect(assistantGreeting(new Date('2026-11-06T14:00:00Z'))).toBe(
      'Good evening, Sri. Lavu Sri Krishna Devarayalu Sir.',
    );
  });

  it('opens a page when the MP asks to go there, and only offers a button for a status question', () => {
    const moving = matchAssistantPage('open grievances');
    expect(moving).toMatchObject({ path: '/grievances', label: 'Grievances', auto: true });

    const asking = matchAssistantPage('how many grievances are pending');
    expect(asking).toMatchObject({ path: '/grievances', auto: false });

    expect(matchAssistantPage('take me to the schedule')).toMatchObject({ path: '/schedule', auto: true });
    expect(matchAssistantPage('people who received a cmrf benefit')).toMatchObject({
      path: '/outreach',
      auto: false,
    });
    expect(matchAssistantPage('what is the water problem in Chilakaluripet')).toBeNull();
  });

  it('summarises the matching records and the page the question points to', () => {
    const page = matchAssistantPage('pending grievances');
    const summary = buildAssistantSummary(
      'pending grievances',
      [{ document_name: 'Street lights (Pending)' }],
      {
        articles: 10,
        bySection: { grievances: { total: 6, pending: 5, inProgress: 1, completed: 0 } },
      },
      page,
    );
    expect(summary).toContain('Grievances: 6 saved, 5 pending, 1 in progress, 0 completed.');
    expect(summary).toContain('Street lights (Pending)');
    expect(summary).toContain('Open Grievances');
  });
});
