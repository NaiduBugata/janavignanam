import { VisitFollowupService } from './visit-followup.service';
import {
  FOLLOW_UP_TEMPLATE,
  followUpParameters,
  listedPhones,
  reminderPlan,
  reminderSlots,
  type FollowUpVisit,
} from './visit-followup';

function visit(overrides: Partial<FollowUpVisit> = {}): FollowUpVisit {
  return {
    id: '1',
    title: 'Hospital visit',
    place: 'Vinukonda',
    visitDate: '2026-10-03',
    visitTime: '10:30',
    leadPhone: '919876543210',
    followUpAutoDay: '',
    ...overrides,
  };
}

describe('visit follow-up timing', () => {
  it('plans three reminders before a timed visit and three daytime reminders when the time is anytime', () => {
    expect(
      reminderSlots('2026-10-03', '10:30').map((slot) => slot.at.toISOString()),
    ).toEqual([
      '2026-10-03T02:00:00.000Z',
      '2026-10-03T03:00:00.000Z',
      '2026-10-03T04:00:00.000Z',
    ]);
    expect(
      reminderSlots('2026-10-03', '').map((slot) => slot.at.toISOString()),
    ).toEqual([
      '2026-10-03T01:30:00.000Z',
      '2026-10-03T06:30:00.000Z',
      '2026-10-03T10:30:00.000Z',
    ]);
    expect(reminderSlots('2026-10-03', '02:00')[0].at.toISOString()).toBe(
      '2026-10-02T17:30:00.000Z',
    );
  });

  it('sends only the allotted number, skips a missed earlier reminder, and stops at the event', () => {
    const daytime = visit();
    expect(
      reminderPlan(daytime, new Date('2026-10-03T01:59:00.000Z')).send,
    ).toBeNull();
    expect(
      reminderPlan(daytime, new Date('2026-10-03T02:00:00.000Z')).send?.id,
    ).toBe('2026-10-03@450');
    expect(
      reminderPlan(daytime, new Date('2026-10-03T03:00:00.000Z')).skip,
    ).toEqual(['2026-10-03@450']);
    expect(
      reminderPlan(daytime, new Date('2026-10-03T03:00:00.000Z')).send?.id,
    ).toBe('2026-10-03@510');
    expect(
      reminderPlan(
        visit({ followUpSent: ['2026-10-03@450'] }),
        new Date('2026-10-03T02:15:00.000Z'),
      ).send,
    ).toBeNull();
    expect(
      reminderPlan(
        visit({ followUpAutoDay: '2026-10-03' }),
        new Date('2026-10-03T02:00:00.000Z'),
      ).send,
    ).toBeNull();
    expect(
      reminderPlan(daytime, new Date('2026-10-03T05:00:00.000Z')).send,
    ).toBeNull();
    expect(
      reminderPlan(
        visit({ leadPhone: '' }),
        new Date('2026-10-03T02:00:00.000Z'),
      ).send,
    ).toBeNull();
    expect(
      reminderPlan(
        visit({ leadPhone: '', leadPhones: ['919876543210'] }),
        new Date('2026-10-03T02:00:00.000Z'),
      ).send,
    ).not.toBeNull();
    expect(
      listedPhones(
        visit({
          leadPhone: '919876543210',
          leadPhones: ['919876543210', '918888888888'],
        }),
      ),
    ).toEqual(['919876543210', '918888888888']);
  });

  it('fills empty place and time so the template stays valid', () => {
    expect(followUpParameters(visit({ place: '', visitTime: '' }))).toEqual({
      title: 'Hospital visit',
      place: 'as scheduled',
      time: 'Anytime',
    });
    expect(followUpParameters(visit()).time).toBe('10:30 AM');
  });
});

describe('VisitFollowupService', () => {
  const saved: Record<string, string | undefined> = {};
  const keys = [
    'WHATSAPP_ENABLED',
    'WHATSAPP_ACCESS_TOKEN',
    'WHATSAPP_PHONE_NUMBER_ID',
  ];

  beforeEach(() => {
    for (const key of keys) {
      saved[key] = process.env[key];
      process.env[key] = key === 'WHATSAPP_ENABLED' ? 'true' : 'token';
    }
  });

  afterEach(() => {
    for (const key of keys) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  it('sends every lead for today, and the automatic job sends each visit only once', async () => {
    const docs = [
      {
        _id: 'v1',
        section: 'visits',
        title: 'Hospital',
        place: 'Vinukonda',
        visitDate: '2026-10-03',
        visitTime: '10:30',
        leadPhone: '919876543210',
        followUpAutoDay: '',
      },
    ];
    const db = {
      ensureConnected: async () => true,
      collection: () => ({
        find: () => ({ toArray: async () => docs }),
        updateOne: async (
          _filter: unknown,
          update: { $set: { followUpSent?: string[] } },
        ) => {
          Object.assign(docs[0], update.$set);
          return { matchedCount: 1 };
        },
      }),
    };
    const calls: Array<{
      template?: { name?: string; components?: unknown[] };
    }> = [];
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      calls.push(JSON.parse(String(init?.body || '{}')));
      return {
        ok: true,
        status: 200,
        json: async () => ({ messages: [{ id: 'wamid.1' }] }),
      } as Response;
    }) as typeof fetch;
    const service = new VisitFollowupService(db as never);
    const now = new Date('2026-10-03T02:00:00.000Z');

    const manual = await service.sendToday(fetchImpl, now);
    expect(manual).toMatchObject({ due: 1, sent: 1, failed: 0 });
    expect(docs[0].followUpAutoDay).toBe('');
    expect(calls[0].template?.name).toBe(FOLLOW_UP_TEMPLATE);
    expect(JSON.stringify(calls[0].template)).not.toContain('919876543210');

    const automatic = await service.sendDue(fetchImpl, now);
    expect(automatic.sent).toBe(1);
    expect(docs[0].followUpSent).toEqual(['2026-10-03@450']);
    expect((await service.sendDue(fetchImpl, now)).due).toBe(0);
    const later = await service.sendDue(
      fetchImpl,
      new Date('2026-10-03T03:00:00.000Z'),
    );
    expect(later.sent).toBe(1);
    expect(docs[0].followUpSent).toEqual(['2026-10-03@450', '2026-10-03@510']);
    expect((await service.sendToday(fetchImpl, now)).sent).toBe(1);
  });

  it('sends every saved visit to every follow-up number, and sends again on the next tap', async () => {
    const docs = [
      {
        _id: 'v1',
        section: 'visits',
        title: 'Survey',
        place: 'Narsaraopet',
        visitDate: '2026-09-29',
        visitTime: '',
        leadPhone: '',
        leadPhones: ['911111111111', '912222222222', '913333333333'],
        followUpAutoDay: '2026-09-29',
      },
    ];
    const db = {
      ensureConnected: async () => true,
      collection: () => ({
        find: () => ({ toArray: async () => docs }),
        updateOne: async () => ({ matchedCount: 1 }),
      }),
    };
    const calls: Array<{ to?: string }> = [];
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      calls.push(JSON.parse(String(init?.body || '{}')));
      return {
        ok: true,
        status: 200,
        json: async () => ({ messages: [{ id: 'wamid.1' }] }),
      } as Response;
    }) as typeof fetch;
    const service = new VisitFollowupService(db as never);
    const first = await service.sendAll(fetchImpl);
    const second = await service.sendAll(fetchImpl);
    expect(first).toMatchObject({ due: 3, sent: 3, failed: 0 });
    expect(second).toMatchObject({ due: 3, sent: 3, failed: 0 });
    expect(calls).toHaveLength(6);
    expect(docs[0].followUpAutoDay).toBe('2026-09-29');
  });
});
