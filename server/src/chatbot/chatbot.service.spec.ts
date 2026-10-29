import { setDemoDataEnabled } from '../admin/demo-data';
import { FOLLOW_UP_SENT } from '../visits/visit-followup';
import {
  clearStaffDirectory,
  setStaffDirectory,
} from '../whatsapp/whatsapp.audience';
import { classifyGrievance } from './grievance-priority';
import {
  FOLLOWUP_PHONE,
  FOLLOWUP_PHONE_LABEL,
  followupBucket,
  followupContactsIn,
  resetFollowupContacts,
} from './followup-contacts';
import {
  ChatbotService,
  GRIEVANCE_RECEIPT,
  MAIN_BUTTONS,
  MAIN_MENU_TEXT,
  VISIT_BUTTONS,
  formatSection,
  isGreetingOnly,
  openingLine,
  timeGreeting,
  toWhatsAppFormat,
} from './chatbot.service';

function payload(body: string, id = 'wamid.1', from = '919876543210') {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'waba',
        changes: [
          {
            field: 'messages',
            value: {
              messages: [
                { from, id, timestamp: '1', type: 'text', text: { body } },
              ],
            },
          },
        ],
      },
    ],
  };
}

function messageText(message: Record<string, unknown>): string {
  if (message.type === 'text')
    return String((message.text as { body?: string } | undefined)?.body || '');
  const interactive = message.interactive as
    { body?: { text?: string } } | undefined;
  return interactive?.body?.text || '';
}

function replyButtons(
  message: Record<string, unknown>,
): Array<{ id: string; title: string }> {
  const interactive = message.interactive as
    | {
        type?: string;
        action?: {
          buttons?: Array<{ reply: { id: string; title: string } }>;
          sections?: Array<{ rows?: Array<{ id: string; title: string }> }>;
        };
      }
    | undefined;
  if (interactive?.type === 'list')
    return (interactive.action?.sections || []).flatMap(
      (section) => section.rows || [],
    );
  if (interactive?.type !== 'button') return [];
  return (interactive.action?.buttons || []).map((button) => button.reply);
}

function buttonPayload(
  id: string,
  title: string,
  messageId = 'wamid.btn',
  from = '919876543210',
) {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'waba',
        changes: [
          {
            field: 'messages',
            value: {
              messages: [
                {
                  from,
                  id: messageId,
                  timestamp: '1',
                  type: 'interactive',
                  interactive: {
                    type: 'button_reply',
                    button_reply: { id, title },
                  },
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

function env(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    CHATBOT_ENABLED: 'true',
    WHATSAPP_ENABLED: 'true',
    WHATSAPP_RECIPIENTS: '919876543210',
    WHATSAPP_ACCESS_TOKEN: 'test-token',
    WHATSAPP_PHONE_NUMBER_ID: '123',
    ...overrides,
  };
}

function fetchImpl(calls: string[]): typeof fetch {
  return async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body || '{}')) as {
      to?: string;
      type?: string;
    };
    calls.push(`${body.type}:${body.to}`);
    return {
      ok: true,
      json: async () => ({ messages: [{ id: 'out' }] }),
    } as Response;
  };
}

function memoryRecords() {
  const rows: Array<Record<string, unknown>> = [];
  const matches = (
    row: Record<string, unknown>,
    filter: Record<string, unknown>,
  ) => Object.entries(filter).every(([key, value]) => row[key] === value);
  const db = {
    ensureConnected: async () => true,
    collection: () => ({
      findOne: async (filter: Record<string, unknown>) =>
        rows.find((row) => matches(row, filter)) || null,
      insertOne: async (doc: Record<string, unknown>) => {
        rows.push({ ...doc });
        return { insertedId: 'id' };
      },
      find: (filter: Record<string, unknown>) => ({
        sort: () => ({
          limit: () => ({
            toArray: async () => rows.filter((row) => matches(row, filter)),
          }),
        }),
      }),
    }),
  };
  return { rows, db };
}

function capture(sent: Array<Record<string, unknown>>): typeof fetch {
  return async (_url: string | URL | Request, init?: RequestInit) => {
    sent.push(
      JSON.parse(String(init?.body || '{}')) as Record<string, unknown>,
    );
    return {
      ok: true,
      json: async () => ({ messages: [{ id: 'out' }] }),
    } as Response;
  };
}

const news = [
  {
    title: 'Older road work',
    summary: 'A drain was repaired.',
    category: 'Civic',
    sentiment: 'Positive',
    severity: 'low',
    place: 'Narasaraopet',
    source: 'lokal',
    url: 'https://example.com/old',
    publishedAt: '2026-09-01T00:00:00Z',
    collectedAt: '2026-09-01T00:00:00Z',
  },
  {
    title: 'Sixth item',
    summary: 'This must not appear.',
    category: 'Civic',
    sentiment: 'Neutral',
    severity: 'low',
    place: 'Sattenapalle',
    source: 'lokal',
    url: 'https://example.com/six',
    publishedAt: '2026-09-02T00:00:00Z',
    collectedAt: '2026-09-02T00:00:00Z',
  },
  {
    title: 'Fifth item',
    summary: 'Market update.',
    category: 'Economy',
    sentiment: 'Neutral',
    severity: 'low',
    place: 'Chilakaluripet',
    source: 'sakshi',
    url: 'https://example.com/five',
    publishedAt: '2026-09-03T00:00:00Z',
    collectedAt: '2026-09-03T00:00:00Z',
  },
  {
    title: 'Fourth item',
    summary: 'School notice.',
    category: 'Education',
    sentiment: 'Positive',
    severity: 'low',
    place: 'Narasaraopet',
    source: 'youtube',
    url: 'https://example.com/four',
    publishedAt: '2026-09-04T00:00:00Z',
    collectedAt: '2026-09-04T00:00:00Z',
  },
  {
    title: 'Third item',
    summary: 'Water supply.',
    category: 'Civic',
    sentiment: 'Negative',
    severity: 'moderate',
    place: 'Vinukonda',
    source: 'lokal',
    url: 'https://example.com/three',
    publishedAt: '2026-09-05T00:00:00Z',
    collectedAt: '2026-09-05T00:00:00Z',
  },
  {
    title: 'Second item',
    summary: 'Crop loss.',
    category: 'Agriculture',
    sentiment: 'Negative',
    severity: 'high',
    place: 'Macherla',
    source: 'sakshi',
    url: 'https://example.com/two',
    publishedAt: '2026-09-06T00:00:00Z',
    collectedAt: '2026-09-06T00:00:00Z',
  },
  {
    title: 'Cordon search in Narasaraopet',
    summary: 'Police searched the Pedda Cheruvu area.',
    category: 'Crime',
    sentiment: 'Negative',
    severity: 'high',
    place: 'Narasaraopet, Palnadu',
    source: 'youtube',
    url: 'https://www.youtube.com/watch?v=x',
    publishedAt: '2026-09-27T07:26:08Z',
    collectedAt: '2026-09-28T04:32:17Z',
  },
];

describe('ChatbotService', () => {
  afterEach(() => {
    clearStaffDirectory();
    setDemoDataEnabled(true);
    resetFollowupContacts();
  });

  it('shows the six reply buttons and ignores a second delivery of the same message', async () => {
    const calls: string[] = [];
    const bot = new ChatbotService();
    await bot.handle(payload('Who are you?'), {
      env: env(),
      fetchImpl: fetchImpl(calls),
    });
    await bot.handle(payload('Who are you?'), {
      env: env(),
      fetchImpl: fetchImpl(calls),
    });
    expect(calls).toEqual(['interactive:919876543210']);
  });

  it('does not reply when the allowlist is empty or the sender is not listed', async () => {
    const calls: string[] = [];
    const bot = new ChatbotService();
    await bot.handle(payload('Hello'), {
      env: env({ WHATSAPP_RECIPIENTS: '' }),
      fetchImpl: fetchImpl(calls),
    });
    await bot.handle(payload('Hello', 'wamid.2', '911111111111'), {
      env: env(),
      fetchImpl: fetchImpl(calls),
    });
    expect(calls).toEqual([]);
  });

  it('answers an admin and stays silent for everyone else once roles are loaded', async () => {
    setStaffDirectory([
      { phone: '919000000001', role: 'superadmin' },
      { phone: '919000000002', role: 'admin' },
    ]);
    const calls: string[] = [];
    const bot = new ChatbotService();
    await bot.handle(payload('Hello', 'wamid.user', '919876543210'), {
      env: env(),
      fetchImpl: fetchImpl(calls),
    });
    await bot.handle(payload('Hello', 'wamid.admin', '919000000002'), {
      env: env(),
      fetchImpl: fetchImpl(calls),
    });
    expect(calls).toEqual(['interactive:919000000002']);
  });

  it('does not reply to delivery statuses', async () => {
    const calls: string[] = [];
    const bot = new ChatbotService();
    await bot.handle(
      {
        object: 'whatsapp_business_account',
        entry: [
          {
            changes: [
              {
                value: {
                  statuses: [
                    {
                      id: 'wamid.1',
                      status: 'delivered',
                      recipient_id: '919876543210',
                    },
                  ],
                },
              },
            ],
          },
        ],
      },
      { env: env(), fetchImpl: fetchImpl(calls) },
    );
    expect(calls).toEqual([]);
  });

  it('answers a greeting with every section as a one-tap button', async () => {
    const sent: Array<Record<string, unknown>> = [];
    const bot = new ChatbotService();
    await bot.handle(payload('Hi', 'wamid.hi'), {
      env: env(),
      fetchImpl: capture(sent),
      now: () => new Date('2026-09-28T13:49:00Z'),
    });
    expect(sent).toHaveLength(1);
    const first = sent[0].interactive as {
      type: string;
      body: { text: string };
      action: { button: string };
    };
    expect(first.type).toBe('list');
    expect(first.action.button).toBe('Menu');
    expect(first).not.toHaveProperty('header');
    expect(JSON.stringify(first)).not.toContain('Campaign updates');
    expect(first.body.text).toContain(
      "Good evening, Sri. Lavu Sri Krishna Devarayalu Sir! I'm your Media Assistant.",
    );
    expect(first.body.text).toContain('Choose a section.');
    const buttons = sent.flatMap(replyButtons);
    expect(buttons.map((button) => button.title)).toEqual(
      MAIN_BUTTONS.map((row) => row.title),
    );
    expect(buttons.length).toBeGreaterThan(3);
    expect(JSON.stringify(sent)).not.toContain('http');
  });

  it('returns only the latest five news items when News is tapped, then the menu list', async () => {
    const sent: Array<Record<string, unknown>> = [];
    const bot = new ChatbotService();
    await bot.handle(buttonPayload('news', 'News', 'wamid.news'), {
      env: env(),
      fetchImpl: capture(sent),
      news,
      now: () => new Date('2026-09-28T13:49:00Z'),
    });
    expect((sent[0].interactive as { type: string }).type).toBe('list');
    const body = messageText(sent[0]);
    expect(body).toContain('*News*');
    expect(body).not.toContain('Latest');
    expect(body.toLowerCase()).not.toContain('menu');
    expect(body).toContain('Cordon search in Narasaraopet');
    expect(body).toContain('Second item');
    expect(body).not.toContain('Sixth item');
    expect(body).not.toContain('Older road work');
    expect(body).not.toContain('http');
    expect(body).not.toContain("I'm your Media Assistant");
    expect(sent.flatMap(replyButtons).map((button) => button.id)).toEqual(
      MAIN_BUTTONS.map((row) => row.id),
    );
  });

  it('sends a long news summary to the end instead of cutting it with an ellipsis', async () => {
    const summary =
      'Police completed the search at Pedda Cheruvu and recorded every statement from the families before closing the case. '
        .repeat(12)
        .trim();
    const sent: Array<Record<string, unknown>> = [];
    const bot = new ChatbotService();
    await bot.handle(buttonPayload('news', 'News', 'wamid.news-full'), {
      env: env(),
      fetchImpl: capture(sent),
      news: [{ ...news[6], summary }],
      now: () => new Date('2026-09-28T13:49:00Z'),
    });
    const texts = sent
      .filter((message) => message.type === 'text')
      .map(messageText);
    expect(texts.join('\n')).toContain(summary);
    expect(texts.join('\n')).not.toContain('…');
    expect(
      sent.some(
        (message) =>
          (message.interactive as { type?: string } | undefined)?.type ===
          'list',
      ),
    ).toBe(true);
  });

  it('returns to News, Visits, and More from the second More without another message', async () => {
    const sent: Array<Record<string, unknown>> = [];
    const bot = new ChatbotService();
    await bot.handle(buttonPayload('home', 'More', 'wamid.menu'), {
      env: env(),
      fetchImpl: capture(sent),
      now: () => new Date('2026-09-28T13:49:00Z'),
    });
    expect(sent.flatMap(replyButtons).map((button) => button.title)).toEqual(
      MAIN_BUTTONS.map((row) => row.title),
    );
    const body = (sent[0].interactive as { body: { text: string } }).body.text;
    expect(body).toBe(MAIN_MENU_TEXT);
    expect(body).not.toContain("I'm your Media Assistant");
  });

  it('keeps every section on the one menu list', async () => {
    const sent: Array<Record<string, unknown>> = [];
    const bot = new ChatbotService();
    await bot.handle(buttonPayload('more', 'More', 'wamid.more'), {
      env: env(),
      fetchImpl: capture(sent),
      now: () => new Date('2026-09-28T13:49:00Z'),
    });
    const interactive = sent[0].interactive as {
      type: string;
      body: { text: string };
    };
    expect(interactive.type).toBe('list');
    expect(interactive.body.text).toBe(MAIN_MENU_TEXT);
    const buttons = sent.flatMap(replyButtons);
    expect(buttons.map((button) => button.id)).toEqual([
      'news',
      'visits',
      'followups',
      'grievances',
      'projects',
      'constituency',
      'campaigns',
      'analytics',
    ]);
    expect(buttons.some((button) => button.id === 'more')).toBe(false);
  });

  it('returns the five newest grievances and keeps projects separate', async () => {
    const sent: Array<Record<string, unknown>> = [];
    const bot = new ChatbotService();
    const records = {
      grievances: [
        {
          title: 'Old drain',
          detail: 'See https://example.com/drain',
          status: 'Closed',
          date: '2026-08-01T00:00:00Z',
        },
        {
          title: 'Sixth grievance',
          detail: 'Too old',
          status: 'Open',
          date: '2026-08-02T00:00:00Z',
        },
        {
          title: 'Street light',
          detail: 'Ward 4',
          status: 'Open',
          date: '2026-09-05T00:00:00Z',
        },
        {
          title: 'Pension delay',
          detail: 'Two households',
          status: 'In progress',
          date: '2026-09-06T00:00:00Z',
        },
        {
          title: 'Water tanker',
          detail: 'Colony request',
          status: 'Open',
          date: '2026-09-07T00:00:00Z',
        },
        {
          title: 'Road patch',
          detail: 'Main road',
          status: 'Open',
          date: '2026-09-08T00:00:00Z',
        },
        {
          title: 'Ration card',
          detail: 'Missing name',
          status: 'Open',
          date: '2026-09-09T00:00:00Z',
        },
      ],
      projects: [
        {
          title: 'School building',
          detail: 'Roof work',
          status: 'Open',
          date: '2026-09-09T00:00:00Z',
        },
      ],
    };
    await bot.handle(buttonPayload('grievances', 'Grievances', 'wamid.g'), {
      env: env(),
      fetchImpl: capture(sent),
      records,
      now: () => new Date('2026-09-28T04:00:00Z'),
    });
    const titles = sent.flatMap(replyButtons).map((row) => row.title);
    expect(titles).toEqual(
      expect.arrayContaining([
        'Ration card',
        'Street light',
        'Water tanker',
        'Pension delay',
        'Road patch',
      ]),
    );
    expect(titles).not.toContain('Sixth grievance');
    expect(titles).not.toContain('Old drain');
    expect(titles).not.toContain('School building');
    expect(JSON.stringify(sent)).not.toContain('http');
    expect(JSON.stringify(sent)).not.toContain('example.com');
  });

  it('opens each conversation with the greeting, but not every reply', async () => {
    const sent: string[] = [];
    const recording = (async (
      _url: string | URL | Request,
      init?: RequestInit,
    ) => {
      const body = JSON.parse(String(init?.body || '{}')) as {
        type?: string;
        text?: { body?: string };
        interactive?: { body?: { text?: string } };
      };
      sent.push(
        body.type === 'text'
          ? body.text?.body || ''
          : body.interactive?.body?.text || '',
      );
      return {
        ok: true,
        json: async () => ({ messages: [{ id: 'out' }] }),
      } as Response;
    }) as typeof fetch;
    const bot = new ChatbotService();
    let clock = new Date('2026-09-28T12:50:00Z');
    const deps = {
      env: env(),
      fetchImpl: recording,
      news: [],
      now: () => clock,
    };
    await bot.handle(payload('latest updates', 'wamid.g1'), deps);
    clock = new Date('2026-09-28T13:00:00Z');
    await bot.handle(payload('Hello', 'wamid.g2'), deps);
    clock = new Date('2026-09-29T03:30:00Z');
    await bot.handle(payload('any news?', 'wamid.g3'), deps);
    expect(sent[0]).toContain('*News*');
    expect(sent[0]).not.toContain("I'm your Media Assistant");
    expect(sent[0].toLowerCase()).not.toContain('menu');
    expect(sent[1]).toBe(MAIN_MENU_TEXT);
    expect(sent[2]).toContain(
      "Good morning, Sri. Lavu Sri Krishna Devarayalu Sir! I'm your Media Assistant.",
    );
  });

  it('greets by India time of day', () => {
    expect(timeGreeting(new Date('2026-09-28T03:30:00Z'))).toBe('Good morning');
    expect(timeGreeting(new Date('2026-09-28T08:00:00Z'))).toBe(
      'Good afternoon',
    );
    expect(timeGreeting(new Date('2026-09-28T12:50:00Z'))).toBe('Good evening');
    expect(timeGreeting(new Date('2026-09-28T20:00:00Z'))).toBe('Good evening');
    expect(openingLine(new Date('2026-09-28T03:30:00Z'), {})).toBe(
      "Good morning, Sri. Lavu Sri Krishna Devarayalu Sir! I'm your Media Assistant.",
    );
  });

  it('recognises a bare greeting but not a question', () => {
    for (const text of [
      'Hi',
      'hello sir',
      'Good evening!',
      'నమస్కారం',
      'Namaste garu',
      'hey 👋',
    ]) {
      expect(isGreetingOnly(text)).toBe(true);
    }
    for (const text of [
      'hi, any news from Macherla?',
      'latest updates',
      'good news today?',
      '',
    ]) {
      expect(isGreetingOnly(text)).toBe(false);
    }
  });

  it('converts markdown bold and headings to WhatsApp formatting', () => {
    expect(
      toWhatsAppFormat('## Today\n**Narasaraopet** – *Crime* – __theft__'),
    ).toBe('Today\n*Narasaraopet* – *Crime* – _theft_');
  });

  it('lets a failed send be tried again', async () => {
    const bot = new ChatbotService();
    const failing = (async () => ({
      ok: false,
      json: async () => ({}),
    })) as typeof fetch;
    await bot.handle(payload('Hi', 'wamid.fail'), {
      env: env(),
      fetchImpl: failing,
    });
    const calls: string[] = [];
    await bot.handle(payload('Hi', 'wamid.fail'), {
      env: env(),
      fetchImpl: fetchImpl(calls),
    });
    expect(calls.some((call) => call.startsWith('interactive:'))).toBe(true);
  });

  it('shows visits with Follow up and More, and never the lead number', async () => {
    const sent: Array<Record<string, unknown>> = [];
    const db = {
      ensureConnected: async () => true,
      collection: () => ({
        find: () => ({
          sort: () => ({
            limit: () => ({
              toArray: async () => [
                {
                  title: 'Hospital round',
                  place: 'Vinukonda',
                  visitDate: '2026-10-03',
                  visitTime: '10:30',
                  detail: 'Met the doctors',
                  leadPhone: '919876543210',
                  createdAt: '2026-10-03T01:00:00.000Z',
                },
              ],
            }),
          }),
        }),
      }),
    };
    const bot = new ChatbotService(undefined, db as never);
    await bot.handle(buttonPayload('visits', 'Visits', 'wamid.visits'), {
      env: env(),
      fetchImpl: capture(sent),
      now: () => new Date('2026-10-03T04:00:00.000Z'),
    });
    const body = messageText(sent[0]);
    expect(body).toContain('*Hospital round*');
    expect(body.toLowerCase()).not.toContain('menu');
    expect(body).not.toContain('9876543210');
    expect(sent.flatMap(replyButtons).map((button) => button.id)).toEqual(
      VISIT_BUTTONS.map((row) => row.id),
    );
  });

  it('returns to News, Visits, and More only after a follow-up is accepted', async () => {
    const sent: Array<Record<string, unknown>> = [];
    const accepted = { sendAll: async () => ({ due: 2, sent: 1, failed: 1 }) };
    const bot = new ChatbotService(undefined, undefined, accepted as never);
    await bot.handle(buttonPayload('follow_up', 'Follow up', 'wamid.follow'), {
      env: env(),
      fetchImpl: capture(sent),
      now: () => new Date('2026-10-03T04:00:00.000Z'),
    });
    const interactive = sent[0].interactive as { body: { text: string } };
    expect(interactive.body.text).toBe(FOLLOW_UP_SENT);
    expect(sent.flatMap(replyButtons).map((button) => button.title)).toEqual(
      MAIN_BUTTONS.map((row) => row.title),
    );
  });

  it('answers Follow up before the visit messages finish', async () => {
    const sent: Array<Record<string, unknown>> = [];
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const follow = {
      readyToSend: async () => true,
      sendAll: () => gate.then(() => ({ due: 2, sent: 1, failed: 0 })),
    };
    const bot = new ChatbotService(undefined, undefined, follow as never);
    await bot.handle(
      buttonPayload('follow_up', 'Follow up', 'wamid.follow-now'),
      {
        env: env(),
        fetchImpl: capture(sent),
        now: () => new Date('2026-10-03T04:00:00.000Z'),
      },
    );
    const interactive = sent[0].interactive as { body: { text: string } };
    expect(interactive.body.text).toBe(FOLLOW_UP_SENT);
    expect(sent.flatMap(replyButtons).map((button) => button.id)).toEqual(
      MAIN_BUTTONS.map((row) => row.id),
    );
    release();
    await gate;
  });

  it('stays on the visit list when there is nobody to message', async () => {
    const sent: Array<Record<string, unknown>> = [];
    const follow = {
      readyToSend: async () => false,
      sendAll: async () => {
        throw new Error('should not send');
      },
    };
    const bot = new ChatbotService(undefined, undefined, follow as never);
    await bot.handle(
      buttonPayload('follow_up', 'Follow up', 'wamid.follow-empty'),
      {
        env: env(),
        fetchImpl: capture(sent),
        records: {
          visits: [
            {
              title: 'Ward meeting',
              detail: 'Ipur',
              status: 'Manual',
              date: '2026-10-03',
            },
          ],
        },
        now: () => new Date('2026-10-03T04:00:00.000Z'),
      },
    );
    expect(messageText(sent[0])).toContain('Ward meeting');
    expect(messageText(sent[0]).toLowerCase()).not.toContain('menu');
    expect(sent.flatMap(replyButtons).map((button) => button.id)).toEqual(
      VISIT_BUTTONS.map((row) => row.id),
    );
  });

  it('stays on the visit list when no follow-up is accepted', async () => {
    const sent: Array<Record<string, unknown>> = [];
    const refused = { sendAll: async () => ({ due: 1, sent: 0, failed: 1 }) };
    const bot = new ChatbotService(undefined, undefined, refused as never);
    await bot.handle(
      buttonPayload('follow_up', 'Follow up', 'wamid.follow-fail'),
      {
        env: env(),
        fetchImpl: capture(sent),
        records: {
          visits: [
            {
              title: 'Ward meeting',
              detail: 'Ipur',
              status: 'Manual',
              date: '2026-10-03',
            },
          ],
        },
        now: () => new Date('2026-10-03T04:00:00.000Z'),
      },
    );
    expect(messageText(sent[0])).toContain('Ward meeting');
    expect(messageText(sent[0])).not.toContain(FOLLOW_UP_SENT);
    expect(messageText(sent[0]).toLowerCase()).not.toContain('menu');
    expect(sent.flatMap(replyButtons).map((button) => button.id)).toEqual(
      VISIT_BUTTONS.map((row) => row.id),
    );
  });

  it('saves a person message as a grievance and sends only a receipt', async () => {
    setStaffDirectory([
      { phone: '919000000002', role: 'admin' },
      { phone: '918885230708', role: 'person', name: 'Udatha Sravani' },
    ]);
    const { rows, db } = memoryRecords();
    const sent: Array<Record<string, unknown>> = [];
    const bot = new ChatbotService(undefined, db as never);
    await bot.handle(
      payload('The road is broken', 'wamid.road', '918885230708'),
      {
        env: env(),
        fetchImpl: capture(sent),
      },
    );
    expect(rows).toEqual([
      expect.objectContaining({
        section: 'grievances',
        title: 'The road is broken',
        detail: 'The road is broken',
        department: 'Roads and buildings',
        leader: 'Lakshmi',
        place: 'Narasaraopet',
        language: 'en',
        priority: 'normal',
        status: 'Open',
        createdBy: 'Udatha Sravani',
        reporterPhone: '918885230708',
        sourceMessageId: 'wamid.road',
      }),
    ]);
    expect(sent).toHaveLength(1);
    expect(sent[0].type).toBe('text');
    expect(sent[0].to).toBe('918885230708');
    expect((sent[0].text as { body: string }).body).toBe(GRIEVANCE_RECEIPT);
    expect(JSON.stringify(sent)).not.toContain('"type":"list"');
  });

  it('does not save the same grievance twice', async () => {
    setStaffDirectory([
      { phone: '918919537879', role: 'person', name: 'Balaji' },
    ]);
    const { rows, db } = memoryRecords();
    const first: Array<Record<string, unknown>> = [];
    const bot = new ChatbotService(undefined, db as never);
    const body = payload('Water supply stopped', 'wamid.water', '918919537879');
    await bot.handle(body, { env: env(), fetchImpl: capture(first) });
    const again: Array<Record<string, unknown>> = [];
    const retry = new ChatbotService(undefined, db as never);
    await retry.handle(body, { env: env(), fetchImpl: capture(again) });
    expect(rows).toHaveLength(1);
    expect(first).toHaveLength(1);
    expect(again).toEqual([]);
  });

  it('shows a saved grievance when an admin opens Grievances', async () => {
    setStaffDirectory([
      { phone: '919000000002', role: 'admin' },
      { phone: '918885230708', role: 'person', name: 'Udatha Sravani' },
    ]);
    const { db } = memoryRecords();
    const bot = new ChatbotService(undefined, db as never);
    await bot.handle(
      payload('Street light is out', 'wamid.light', '918885230708'),
      {
        env: env(),
        fetchImpl: capture([]),
      },
    );
    const sent: Array<Record<string, unknown>> = [];
    await bot.handle(
      buttonPayload('grievances', 'Grievances', 'wamid.ask', '919000000002'),
      {
        env: env(),
        fetchImpl: capture(sent),
      },
    );
    const titles = sent.flatMap(replyButtons).map((row) => row.title);
    expect(titles).toContain('Street light is out');
    expect(JSON.stringify(sent)).not.toContain('Udatha Sravani');
    expect(sent).toHaveLength(1);
    expect(sent[0].type).toBe('interactive');
  });

  it('stores a photo from a person as a short note', async () => {
    setStaffDirectory([
      { phone: '918919537879', role: 'person', name: 'Balaji' },
    ]);
    const { rows, db } = memoryRecords();
    const bot = new ChatbotService(undefined, db as never);
    await bot.handle(
      {
        object: 'whatsapp_business_account',
        entry: [
          {
            changes: [
              {
                value: {
                  messages: [
                    {
                      from: '918919537879',
                      id: 'wamid.photo',
                      timestamp: '1',
                      type: 'image',
                      image: { id: 'media' },
                    },
                  ],
                },
              },
            ],
          },
        ],
      },
      { env: env(), fetchImpl: capture([]) },
    );
    expect(rows[0]).toMatchObject({
      title: 'Sent a photo.',
      detail: 'Sent a photo.',
      status: 'Open',
      priority: 'normal',
      createdBy: 'Balaji',
    });
  });

  it('marks urgent grievance words as high priority', () => {
    expect(classifyGrievance('No drinking water in the colony').priority).toBe(
      'high',
    );
    expect(classifyGrievance('Please share the meeting time').priority).toBe(
      'normal',
    );
    expect(classifyGrievance('maa gram lo neellu levu').priority).toBe('high');
    expect(classifyGrievance('maa gram lo').priority).toBe('normal');
  });

  it('keeps romanized Telugu as typed when the MP opens it', async () => {
    setStaffDirectory([
      { phone: '918885230708', role: 'person', name: 'Udatha Sravani' },
      { phone: '919553147457', role: 'mp' },
    ]);
    const { rows, db } = memoryRecords();
    const bot = new ChatbotService(undefined, db as never);
    await bot.handle(
      payload('maa gram lo neellu levu', 'wamid.roman', '918885230708'),
      {
        env: env(),
        fetchImpl: capture([]),
      },
    );
    expect(rows[0]).toMatchObject({
      detail: 'maa gram lo neellu levu',
      priority: 'high',
      department: 'Water supply',
    });
    const sent: Array<Record<string, unknown>> = [];
    await bot.handle(
      buttonPayload(
        'g:wamid.roman',
        'maa gram lo neellu levu',
        'wamid.mp-roman',
        '919553147457',
      ),
      {
        env: env(),
        fetchImpl: capture(sent),
      },
    );
    expect(messageText(sent[0])).toContain('maa gram lo neellu levu');
    expect(messageText(sent[0])).not.toContain('No drinking water');
  });

  it('gives the MP six updated items and keeps an admin at five', async () => {
    setStaffDirectory([
      {
        phone: '919912514034',
        role: 'mp',
        name: 'Shri Lavu Sri Krishna Devarayalu',
      },
      { phone: '919876543210', role: 'admin' },
    ]);
    const mpSent: Array<Record<string, unknown>> = [];
    const bot = new ChatbotService();
    await bot.handle(
      buttonPayload('news', 'News', 'wamid.mp-news', '919912514034'),
      {
        env: env(),
        fetchImpl: capture(mpSent),
        news,
        now: () => new Date('2026-09-28T13:49:00Z'),
      },
    );
    const mpBody = messageText(mpSent[0]);
    expect(mpBody).toContain('6. *Sixth item*');
    expect(mpBody).not.toContain('Older road work');
    const adminSent: Array<Record<string, unknown>> = [];
    await bot.handle(
      buttonPayload('news', 'News', 'wamid.admin-news', '919876543210'),
      {
        env: env(),
        fetchImpl: capture(adminSent),
        news,
        now: () => new Date('2026-09-28T13:49:00Z'),
      },
    );
    const adminBody = messageText(adminSent[0]);
    expect(adminBody).toContain('5. *Fifth item*');
    expect(adminBody).not.toContain('Sixth item');
  });

  it('hides mock rows when demo data is off', async () => {
    setDemoDataEnabled(false);
    setStaffDirectory([{ phone: '919553147457', role: 'mp' }]);
    const sent: Array<Record<string, unknown>> = [];
    const bot = new ChatbotService();
    await bot.handle(
      buttonPayload(
        'grievances',
        'Grievances',
        'wamid.demo-off',
        '919553147457',
      ),
      {
        env: env(),
        fetchImpl: capture(sent),
        records: {
          grievances: [
            {
              id: 'mock-1',
              title: 'Road damage',
              detail: 'MOCK-VISIT',
              status: 'Open',
              date: '2026-10-12T00:00:00Z',
              source: 'mock',
            },
            {
              id: 'real-1',
              title: 'Broken drain',
              detail: 'Ward 2 drain is blocked',
              status: 'Open',
              date: '2026-10-12T01:00:00Z',
            },
          ],
        },
      },
    );
    const ids = sent.flatMap(replyButtons).map((row) => row.id);
    expect(ids).toContain('g:real-1');
    expect(ids).not.toContain('g:mock-1');
  });

  it('shows the MP grievances as options with high priority first', async () => {
    setStaffDirectory([{ phone: '919553147457', role: 'mp' }]);
    const sent: Array<Record<string, unknown>> = [];
    const bot = new ChatbotService();
    await bot.handle(
      buttonPayload('grievances', 'Grievances', 'wamid.mp-g', '919553147457'),
      {
        env: env(),
        fetchImpl: capture(sent),
        records: {
          grievances: [
            {
              id: 'normal-1',
              title: 'Street lights',
              detail: 'Lights are out',
              status: 'Open',
              date: '2026-10-10T00:00:00Z',
              priority: 'normal',
            },
            {
              id: 'high-1',
              title: 'No drinking water',
              detail: 'Colony has no water',
              status: 'Open',
              date: '2026-10-09T00:00:00Z',
              priority: 'high',
            },
          ],
        },
      },
    );
    const rows = sent.flatMap(replyButtons);
    expect(rows.map((row) => row.id)).toEqual([
      'g:high-1',
      'g:normal-1',
      'home',
    ]);
    expect(rows[0]).toMatchObject({ title: 'No drinking water' });
    expect(JSON.stringify(sent)).toContain('High priority');
    await bot.handle(
      buttonPayload(
        'g:high-1',
        'No drinking water',
        'wamid.mp-pick',
        '919553147457',
      ),
      {
        env: env(),
        fetchImpl: capture(sent),
        records: {
          grievances: [
            {
              id: 'normal-1',
              title: 'Street lights',
              detail: 'Lights are out',
              status: 'Open',
              date: '2026-10-10T00:00:00Z',
              priority: 'normal',
            },
            {
              id: 'high-1',
              title: 'No drinking water',
              detail: 'Colony has no water',
              status: 'Open',
              date: '2026-10-09T00:00:00Z',
              priority: 'high',
            },
          ],
        },
      },
    );
    expect(messageText(sent[1])).toContain('Colony has no water');
    const opened = sent[1].interactive as {
      type: string;
      action: { button: string };
    };
    expect(opened.type).toBe('list');
    expect(opened.action.button).toBe('Menu');
    expect(replyButtons(sent[1]).map((row) => row.title)).toEqual([
      'Follow up',
      ...MAIN_BUTTONS.map((row) => row.title),
    ]);
    expect(replyButtons(sent[1])[0].id).toBe('gf:high-1');
  });

  it('sends the grievance follow up to Akshay and the progress note to the person who raised it', async () => {
    setStaffDirectory([
      { phone: '919876543210', role: 'admin', name: 'Akshay Guptha' },
      { phone: '918885230708', role: 'person', name: 'Udatha Sravani' },
      { phone: '919553147457', role: 'mp' },
    ]);
    const sent: Array<Record<string, unknown>> = [];
    const bot = new ChatbotService();
    await bot.handle(
      buttonPayload('gf:high-1', 'Follow up', 'wamid.follow-g', '919553147457'),
      {
        env: env(),
        fetchImpl: capture(sent),
        records: {
          grievances: [
            {
              id: 'high-1',
              title: 'Udatha Sravani',
              detail: 'No drinking water in Vinukonda. Call 918885230708.',
              status: 'Open',
              date: '2026-10-09T00:00:00Z',
              priority: 'high',
              createdBy: 'Udatha Sravani',
            },
          ],
        },
      },
    );
    const texts = sent.filter((message) => message.type === 'text');
    expect(texts.map((message) => message.to)).toEqual([
      '919876543210',
      '919876543210',
      '918885230708',
    ]);
    const order = messageText(texts[0]);
    expect(order).toContain('Need to solve this immediately');
    expect(order).toContain('Vinukonda');
    expect(order).toContain('No drinking water');
    expect(order).toContain('Leader to contact: Ramesh');
    expect(order).toContain('Update the work progress:');
    expect(order).toContain('/progress/');
    expect(order).not.toContain('Udatha');
    expect(order).not.toContain('918885230708');
    expect(messageText(texts[1])).toContain(
      'leader to contact for this issue: Ramesh',
    );
    expect(messageText(texts[2])).toContain('as early as possible');
    expect(messageText(texts[2])).toContain('Thank you');
    expect(messageText(texts[2])).not.toContain(
      'Need to solve this immediately',
    );
    const menu = sent.find((message) => message.type === 'interactive') as {
      interactive: { type: string; action: { button: string } };
    };
    expect(menu.interactive.type).toBe('list');
    expect(menu.interactive.action.button).toBe('Menu');
    expect(replyButtons(menu).map((row) => row.id)).toEqual(
      MAIN_BUTTONS.map((row) => row.id),
    );
  });

  it('tells the person who raised a Telugu issue in Telugu', async () => {
    setStaffDirectory([
      { phone: '919876543210', role: 'admin', name: 'Akshay Guptha' },
      { phone: '918885230708', role: 'person', name: 'Udatha Sravani' },
      { phone: '919553147457', role: 'mp' },
    ]);
    const sent: Array<Record<string, unknown>> = [];
    const bot = new ChatbotService();
    await bot.handle(
      buttonPayload('gf:te-1', 'Follow up', 'wamid.follow-te', '919553147457'),
      {
        env: env(),
        fetchImpl: capture(sent),
        records: {
          grievances: [
            {
              id: 'te-1',
              title: 'రోడ్డు పాడైంది',
              detail: 'రోడ్డు పాడైంది',
              status: 'Open',
              date: '2026-10-10T00:00:00Z',
              priority: 'normal',
              language: 'te',
              reporterPhone: '918885230708',
              createdBy: 'Udatha Sravani',
            },
          ],
        },
      },
    );
    const texts = sent.filter((message) => message.type === 'text');
    expect(texts.map((message) => message.to)).toEqual([
      '919876543210',
      '919876543210',
      '918885230708',
    ]);
    expect(messageText(texts[1])).toContain('Lakshmi');
    expect(messageText(texts[2])).toBe(
      'మీ సమస్యను పరిష్కరిస్తున్నాము. కొన్ని రోజుల్లో లేదా వీలైనంత త్వరగా పరిష్కారం అవుతుంది. ధన్యవాదాలు.',
    );
  });

  it('splits sample grievances between Bobby and Sravani', async () => {
    setStaffDirectory([
      { phone: '919876543210', role: 'admin', name: 'Akshay Guptha' },
      { phone: '919100000001', role: 'person', name: 'Bobby' },
      { phone: '918885230708', role: 'person', name: 'Udatha Sravani' },
      { phone: '919553147457', role: 'mp' },
    ]);
    const samples = {
      grievances: [
        {
          id: 'water',
          title: 'No drinking water',
          detail: 'Vinukonda colony has had no water for two days.',
          status: 'Open',
          date: '2026-10-09T00:00:00Z',
          priority: 'high' as const,
          source: 'mock',
          createdBy: 'Sample',
        },
        {
          id: 'road',
          title: 'Road damage',
          detail: 'The main road near Narasaraopet bus stand is broken.',
          status: 'Open',
          date: '2026-10-09T00:00:00Z',
          priority: 'high' as const,
          source: 'mock',
          createdBy: 'Sample',
        },
      ],
    };
    const bot = new ChatbotService();
    const water: Array<Record<string, unknown>> = [];
    await bot.handle(
      buttonPayload(
        'gf:water',
        'Follow up',
        'wamid.follow-water',
        '919553147457',
      ),
      {
        env: env(),
        fetchImpl: capture(water),
        records: samples,
      },
    );
    const waterTexts = water.filter((message) => message.type === 'text');
    expect(waterTexts.map((message) => message.to)).toEqual([
      '919876543210',
      '919876543210',
      '919100000001',
    ]);
    expect(messageText(waterTexts[0])).toContain(
      'Need to solve this immediately',
    );
    expect(messageText(waterTexts[2])).toContain('Thank you');
    const road: Array<Record<string, unknown>> = [];
    await bot.handle(
      buttonPayload(
        'gf:road',
        'Follow up',
        'wamid.follow-road',
        '919553147457',
      ),
      {
        env: env(),
        fetchImpl: capture(road),
        records: samples,
      },
    );
    const roadTexts = road.filter((message) => message.type === 'text');
    expect(roadTexts.map((message) => message.to)).toEqual([
      '919876543210',
      '919876543210',
      '918885230708',
    ]);
    expect(messageText(roadTexts[0])).toContain('Leader to contact: Lakshmi');
    expect(messageText(roadTexts[1])).toContain(
      'leader to contact for this issue: Lakshmi',
    );
    expect(messageText(roadTexts[2])).toContain('as early as possible');
  });

  it('drops a followed grievance from the WhatsApp list and marks it reviewed', async () => {
    setStaffDirectory([
      { phone: '919876543210', role: 'admin', name: 'Akshay Guptha' },
      { phone: '918885230708', role: 'person', name: 'Udatha Sravani' },
      { phone: '919553147457', role: 'mp' },
    ]);
    const grievances = [
      {
        id: 'high-1',
        title: 'No drinking water',
        detail: 'Colony has no water',
        status: 'Open',
        date: '2026-10-09T00:00:00Z',
        priority: 'high' as const,
      },
      {
        id: 'normal-1',
        title: 'Street lights',
        detail: 'Lights are out',
        status: 'Open',
        date: '2026-10-10T00:00:00Z',
        priority: 'normal' as const,
      },
    ];
    const bot = new ChatbotService();
    await bot.handle(
      buttonPayload('gf:high-1', 'Follow up', 'wamid.review', '919553147457'),
      {
        env: env(),
        fetchImpl: capture([]),
        records: { grievances },
      },
    );
    expect(grievances[0]).toMatchObject({
      status: 'Reviewed',
      followUpDepartment: 'Water supply',
    });
    expect(grievances[1].status).toBe('Open');
    const listed: Array<Record<string, unknown>> = [];
    await bot.handle(
      buttonPayload(
        'grievances',
        'Grievances',
        'wamid.review-list',
        '919553147457',
      ),
      {
        env: env(),
        fetchImpl: capture(listed),
        records: { grievances },
      },
    );
    expect(listed.flatMap(replyButtons).map((row) => row.id)).toEqual([
      'g:normal-1',
      'home',
    ]);
    expect(JSON.stringify(listed)).not.toContain('No drinking water');
  });

  it('answers a Telugu grievance in Telugu', async () => {
    setStaffDirectory([
      { phone: '918885230708', role: 'person', name: 'Udatha Sravani' },
    ]);
    const { rows, db } = memoryRecords();
    const sent: Array<Record<string, unknown>> = [];
    const bot = new ChatbotService(undefined, db as never);
    await bot.handle(payload('రోడ్డు పాడైంది', 'wamid.te', '918885230708'), {
      env: env(),
      fetchImpl: capture(sent),
    });
    expect((sent[0].text as { body: string }).body).toBe(
      'మీ సమస్య అందింది. దీనిని పరిశీలించి పరిష్కరిస్తాము.',
    );
    expect(rows[0]).toMatchObject({
      language: 'te',
      department: 'రోడ్లు మరియు భవనాలు',
    });
  });

  it('tells the super admin when a person files a grievance', async () => {
    setStaffDirectory([
      { phone: '916281168530', role: 'superadmin', name: 'Sarojininaidu' },
      { phone: '918885230708', role: 'person', name: 'Udatha Sravani' },
    ]);
    const { rows, db } = memoryRecords();
    const sent: Array<Record<string, unknown>> = [];
    const bot = new ChatbotService(undefined, db as never);
    await bot.handle(
      payload(
        'No drinking water since morning',
        'wamid.water-g',
        '918885230708',
      ),
      {
        env: env(),
        fetchImpl: capture(sent),
      },
    );
    expect(rows[0]).toMatchObject({
      priority: 'high',
      title: 'No drinking water since morning',
      createdBy: 'Udatha Sravani',
    });
    expect(sent.map((message) => message.to)).toEqual([
      '918885230708',
      '916281168530',
    ]);
    expect((sent[1].text as { body: string }).body).toContain('Udatha Sravani');
    expect((sent[1].text as { body: string }).body).toContain('High priority');
    expect(sent.every((message) => message.type === 'text')).toBe(true);
  });

  it('lets the super admin open the same grievance list as the MP', async () => {
    setStaffDirectory([
      { phone: '916281168530', role: 'superadmin', name: 'Sarojininaidu' },
    ]);
    const sent: Array<Record<string, unknown>> = [];
    const bot = new ChatbotService();
    await bot.handle(
      buttonPayload(
        'grievances',
        'Grievances',
        'wamid.super-g',
        '916281168530',
      ),
      {
        env: env(),
        fetchImpl: capture(sent),
        records: {
          grievances: [
            {
              id: 'normal-1',
              title: 'Street lights',
              detail: 'Lights are out',
              status: 'Open',
              date: '2026-10-10T00:00:00Z',
              priority: 'normal',
            },
            {
              id: 'high-1',
              title: 'No drinking water',
              detail: 'Colony has no water',
              status: 'Open',
              date: '2026-10-09T00:00:00Z',
              priority: 'high',
            },
          ],
        },
      },
    );
    expect(sent.flatMap(replyButtons).map((row) => row.id)).toEqual([
      'g:high-1',
      'g:normal-1',
      'home',
    ]);
  });

  it('stores sample campaigns when that section is empty', async () => {
    setStaffDirectory([{ phone: '919876543210', role: 'admin' }]);
    const { rows, db } = memoryRecords();
    const sent: Array<Record<string, unknown>> = [];
    const bot = new ChatbotService(undefined, db as never);
    await bot.handle(buttonPayload('campaigns', 'Campaigns', 'wamid.camp'), {
      env: env(),
      fetchImpl: capture(sent),
    });
    expect(rows.map((row) => row.title)).toEqual([
      'Door to door',
      'Youth meeting',
      'Rythu bharosa',
      'Health camp',
    ]);
    expect(messageText(sent[0])).toContain('Door to door');
    expect(messageText(sent[0])).toContain('Health camp');
  });

  it('counts analytics instead of repeating news headlines', async () => {
    setStaffDirectory([{ phone: '919876543210', role: 'admin' }]);
    const sent: Array<Record<string, unknown>> = [];
    const bot = new ChatbotService();
    await bot.handle(
      buttonPayload('analytics', 'Analytics', 'wamid.analytics'),
      {
        env: env(),
        fetchImpl: capture(sent),
        news,
      },
    );
    const body = messageText(sent[0]);
    expect(body).toContain('*Analytics*');
    expect(body).toContain('7 articles counted');
    expect(body).toContain('Positive 2');
    expect(body).toContain('Negative 3');
    expect(body).toContain('Narasaraopet 3');
    expect(body).not.toContain('Cordon search');
    expect(body).not.toContain('Water supply');
  });

  it('uses Narasaraopet sample counts when no articles are stored', async () => {
    setStaffDirectory([{ phone: '919876543210', role: 'admin' }]);
    const sent: Array<Record<string, unknown>> = [];
    const bot = new ChatbotService();
    await bot.handle(
      buttonPayload('analytics', 'Analytics', 'wamid.analytics-empty'),
      {
        env: env(),
        fetchImpl: capture(sent),
        news: [],
      },
    );
    const body = messageText(sent[0]);
    expect(body).toContain('Narasaraopet constituency');
    expect(body).toContain('Positive 19');
    expect(body).not.toContain('Nothing saved yet');
  });

  it('stores Narasaraopet projects and constituency details when those sections are empty', async () => {
    setStaffDirectory([{ phone: '919876543210', role: 'admin' }]);
    const { rows, db } = memoryRecords();
    const sent: Array<Record<string, unknown>> = [];
    const bot = new ChatbotService(undefined, db as never);
    await bot.handle(
      buttonPayload('projects', 'Projects & reports', 'wamid.projects'),
      {
        env: env(),
        fetchImpl: capture(sent),
      },
    );
    expect(
      rows.filter((row) => row.section === 'projects').map((row) => row.title),
    ).toContain('Vinukonda hospital');
    expect(messageText(sent[0])).toContain('Narasaraopet municipal pipeline');
    await bot.handle(
      buttonPayload('constituency', 'Constituency', 'wamid.constituency'),
      {
        env: env(),
        fetchImpl: capture(sent),
      },
    );
    const people = rows
      .filter((row) => row.section === 'people')
      .map((row) => row.title);
    expect(people).toEqual(
      expect.arrayContaining([
        'Narasaraopet Lok Sabha',
        'Chilakaluripet',
        'Pedakurapadu',
      ]),
    );
    expect(messageText(sent[1])).toContain('Sri Lavu Sri Krishna Devarayalu');
    expect(messageText(sent[1])).toContain('Gurazala');
  });

  it('opens Followup with recent, frequent, and not followed up lists', async () => {
    const sent: Array<Record<string, unknown>> = [];
    const bot = new ChatbotService();
    await bot.handle(
      buttonPayload('followups', 'Followup', 'wamid.followups'),
      {
        env: env(),
        fetchImpl: capture(sent),
      },
    );
    expect(replyButtons(sent[0]).map((row) => row.id)).toEqual([
      'fu:recent',
      'fu:frequent',
      'fu:pending',
      'home',
    ]);
    expect(messageText(sent[0])).toContain('Followup');
  });

  it('lists all recent follow-up contacts with the shared number', async () => {
    const sent: Array<Record<string, unknown>> = [];
    const bot = new ChatbotService();
    await bot.handle(
      buttonPayload('fu:recent', 'Recent Follow-ups', 'wamid.fu-recent'),
      {
        env: env(),
        fetchImpl: capture(sent),
      },
    );
    const rows = sent
      .flatMap(replyButtons)
      .filter((row) => row.id.startsWith('fu:c:'));
    expect(rows).toHaveLength(25);
    expect(sent.length).toBeGreaterThanOrEqual(3);
    expect(JSON.stringify(sent)).toContain(FOLLOWUP_PHONE_LABEL);
    expect(rows.map((row) => row.title)).toEqual(
      expect.arrayContaining(['Ravi Teja', 'Vikram Singh']),
    );
    expect(
      replyButtons(sent[sent.length - 1]).some((row) => row.id === 'home'),
    ).toBe(true);
  });

  it('lists all frequently followed contacts and the pending names on the same number', async () => {
    const frequent: Array<Record<string, unknown>> = [];
    const pending: Array<Record<string, unknown>> = [];
    const bot = new ChatbotService();
    await bot.handle(
      buttonPayload(
        'fu:frequent',
        'Frequently Followed Up',
        'wamid.fu-frequent',
      ),
      {
        env: env(),
        fetchImpl: capture(frequent),
      },
    );
    await bot.handle(
      buttonPayload('fu:pending', 'Not followed up', 'wamid.fu-pending'),
      {
        env: env(),
        fetchImpl: capture(pending),
      },
    );
    expect(
      frequent
        .flatMap(replyButtons)
        .filter((row) => row.id.startsWith('fu:c:')),
    ).toHaveLength(25);
    const pendingRows = pending
      .flatMap(replyButtons)
      .filter((row) => row.id.startsWith('fu:c:'));
    expect(pendingRows.length).toBeGreaterThanOrEqual(5);
    expect(pendingRows.length).toBeLessThanOrEqual(10);
    expect(JSON.stringify(pending)).toContain(FOLLOWUP_PHONE_LABEL);
  });

  it('sends a follow-up to the contact number and moves them to Recent, then Frequent', async () => {
    const sent: Array<Record<string, unknown>> = [];
    const bot = new ChatbotService();
    await bot.handle(buttonPayload('fu:c:n01', 'Balaji Rao', 'wamid.fu-n01'), {
      env: env(),
      fetchImpl: capture(sent),
    });
    const texts = sent.filter((message) => message.type === 'text');
    expect(texts[0].to).toBe(FOLLOWUP_PHONE);
    expect(messageText(texts[0])).toContain('Balaji Rao');
    expect(messageText(texts[1])).toContain('Recent Follow-ups');
    expect(
      followupBucket(
        followupContactsIn('recent').find((row) => row.id === 'n01')!,
      ),
    ).toBe('recent');
    sent.length = 0;
    await bot.handle(
      buttonPayload('fu:c:n01', 'Balaji Rao', 'wamid.fu-n01-again'),
      {
        env: env(),
        fetchImpl: capture(sent),
      },
    );
    expect(
      messageText(
        sent.find(
          (message) => message.type === 'text' && message.to === '919876543210',
        ) || {},
      ),
    ).toContain('Frequently Followed Up');
    expect(followupContactsIn('frequent').some((row) => row.id === 'n01')).toBe(
      true,
    );
    expect(followupContactsIn('pending').some((row) => row.id === 'n01')).toBe(
      false,
    );
  });

  it('caps a section at five lines', () => {
    const body = formatSection('News', ['a', 'b', 'c', 'd', 'e', 'f']);
    expect(body).toContain('5. e');
    expect(body).not.toContain('Latest');
    expect(body).not.toContain('6. f');
  });
});
