import { ChatbotService, type MenuRecord } from './chatbot.service';
import { setStaffDirectory } from '../whatsapp/whatsapp.audience';
import { setDemoDataEnabled } from '../admin/demo-data';

function env(): NodeJS.ProcessEnv {
  return {
    CHATBOT_ENABLED: 'true',
    WHATSAPP_ENABLED: 'true',
    WHATSAPP_RECIPIENTS: '919876543210',
    WHATSAPP_ACCESS_TOKEN: 'test-token',
    WHATSAPP_PHONE_NUMBER_ID: '123',
    GROQ_API_KEY: '', // Test deterministic grounded fallback
  };
}

function capture(messages: Array<Record<string, unknown>>): typeof fetch {
  return async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body || '{}')) as Record<
      string,
      unknown
    >;
    messages.push(body);
    return {
      ok: true,
      json: async () => ({ messages: [{ id: 'out' }] }),
    } as Response;
  };
}

function payload(body: string, id = 'wamid.query1', from = '919876543210') {
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

describe('Chatbot Database & Progress Grounding', () => {
  beforeEach(() => {
    setStaffDirectory([{ phone: '919876543210', role: 'admin' }]);
    setDemoDataEnabled(false); // Strict production mode
  });

  it('answers query using only authoritative database records with status and department remarks', async () => {
    const testRecords: Record<string, MenuRecord[]> = {
      grievances: [
        {
          id: 'jv-rec-101',
          title: 'Damaged water pipeline near bus stand',
          detail:
            'Pipeline leaking water continuously onto the road for 3 days.',
          status: 'In progress',
          date: '2026-10-25T10:00:00.000Z',
          place: 'Narasaraopet',
          department: 'Water Supply Department',
          progressRemarks: 'Repair crew dispatched. Pipe replacement underway.',
          progressUpdatedAt: '2026-10-26T14:30:00.000Z',
          progressStages: [
            {
              name: 'Initial Inspection',
              status: 'Completed',
              note: 'Site inspected',
            },
            {
              name: 'Field Work',
              status: 'In progress',
              note: 'Digging and replacement',
            },
            { name: 'Final Verification', status: 'Pending' },
          ],
        },
      ],
    };

    const sent: Array<Record<string, unknown>> = [];
    const bot = new ChatbotService();

    await bot.handle(
      payload('What is the progress on the water pipeline near bus stand?'),
      {
        env: env(),
        fetchImpl: capture(sent),
        records: testRecords,
      },
    );

    expect(sent.length).toBeGreaterThanOrEqual(1);
    const textMessages = sent.filter((m) => m.type === 'text');
    expect(textMessages.length).toBe(1);

    const reply = messageText(textMessages[0]);
    expect(reply).toContain('Damaged water pipeline near bus stand');
    expect(reply).toContain('Status: *In progress*');
    expect(reply).toContain('Department: Water Supply Department');
    expect(reply).toContain(
      'Repair crew dispatched. Pipe replacement underway.',
    );
    expect(reply).toContain('1 completed, 1 in progress, 1 pending');
  });

  it('communicates that no matching information was found when record does not exist', async () => {
    const testRecords: Record<string, MenuRecord[]> = {
      grievances: [
        {
          id: 'rec-1',
          title: 'Streetlight repair',
          detail: 'Ward 4 streetlights not working',
          status: 'Completed',
          date: '2026-10-20T00:00:00Z',
        },
      ],
    };

    const sent: Array<Record<string, unknown>> = [];
    const bot = new ChatbotService();

    await bot.handle(
      payload('Status of non-existent flyover bridge project 99999'),
      {
        env: env(),
        fetchImpl: capture(sent),
        records: testRecords,
      },
    );

    const textMessages = sent.filter((m) => m.type === 'text');
    expect(textMessages.length).toBe(1);
    const reply = messageText(textMessages[0]);
    expect(reply).toContain(
      'No matching information was found in the constituency database',
    );
    expect(reply).not.toContain('Flyover');
  });

  it('returns temporary unavailability message when database connection fails', async () => {
    const mockDb = {
      ensureConnected: async () => false, // Simulate DB down
      collection: () => {
        throw new Error('Database disconnected');
      },
    };

    const sent: Array<Record<string, unknown>> = [];
    const bot = new ChatbotService(undefined, mockDb as never);

    await bot.handle(payload('Check status of drinking water supply project'), {
      env: env(),
      fetchImpl: capture(sent),
    });

    const textMessages = sent.filter((m) => m.type === 'text');
    expect(textMessages.length).toBe(1);
    const reply = messageText(textMessages[0]);
    expect(reply).toContain('constituency database is temporarily unavailable');
  });

  it('excludes mock and demo records when demo data is disabled', async () => {
    const mixedRecords: Record<string, MenuRecord[]> = {
      grievances: [
        {
          id: 'demo-1',
          title: 'MOCK water issue',
          detail: 'MOCK-VISIT sample detail',
          status: 'Open',
          date: '2026-10-01T00:00:00Z',
          source: 'mock',
        },
        {
          id: 'real-1',
          title: 'Real hospital construction project',
          detail: 'New pediatric ward construction progress',
          status: 'In progress',
          date: '2026-10-26T00:00:00Z',
          department: 'Health & Medical',
          progressRemarks: 'Foundation complete',
        },
      ],
    };

    const sent: Array<Record<string, unknown>> = [];
    const bot = new ChatbotService();

    await bot.handle(
      payload('Tell me about the hospital construction project'),
      {
        env: env(),
        fetchImpl: capture(sent),
        records: mixedRecords,
      },
    );

    const textMessages = sent.filter((m) => m.type === 'text');
    const reply = messageText(textMessages[0]);
    expect(reply).toContain('Real hospital construction project');
    expect(reply).toContain('Foundation complete');
    expect(reply).not.toContain('MOCK');
  });
});
