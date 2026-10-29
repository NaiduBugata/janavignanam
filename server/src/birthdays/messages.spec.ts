import { BadRequestException } from '@nestjs/common';
import { ObjectId } from 'mongodb';
import { DatabaseService } from '../database/database.service';
import { matches } from '../database/pg-collection';
import {
  noteContactInbound,
  setContactInboundRecorder,
  setMutedSenders,
} from '../whatsapp/whatsapp.muted';
import { freeTextOpen } from './birthdays';
import { BirthdaysService } from './birthdays.service';
import {
  bestState,
  cleanParam,
  deliveryError,
  fillTemplate,
  personalize,
  sendableTemplates,
} from './messages';
import { ContactMessagesService } from './messages.service';

const ENV = [
  'WHATSAPP_ENABLED',
  'WHATSAPP_ACCESS_TOKEN',
  'WHATSAPP_PHONE_NUMBER_ID',
  'WHATSAPP_WABA_ID',
];

const TEMPLATES = [
  {
    name: 'bday_wishes_en',
    status: 'APPROVED',
    category: 'MARKETING',
    language: 'en',
    parameter_format: 'NAMED',
    components: [
      {
        type: 'BODY',
        text: 'Namaste {{name}},\n\nHappy birthday!\n\nLavu Sri Krishna Devarayulu',
      },
    ],
  },
  {
    name: 'jv_mp_action_request',
    status: 'APPROVED',
    category: 'MARKETING',
    language: 'en',
    components: [
      {
        type: 'BODY',
        text: 'Hello {{1}}, the MP asks about {{2}}. Reference: {{3}}',
      },
      { type: 'FOOTER', text: 'JanaVignanam' },
    ],
  },
  {
    name: 'mediasphere_critical_issue',
    status: 'APPROVED',
    language: 'en',
    components: [{ type: 'BODY', text: 'CRITICAL {{1}}' }],
  },
  {
    name: 'pending_one',
    status: 'PENDING',
    language: 'en',
    components: [{ type: 'BODY', text: 'Hi {{1}}' }],
  },
  {
    name: 'with_image',
    status: 'APPROVED',
    language: 'en',
    components: [
      { type: 'HEADER', format: 'IMAGE' },
      { type: 'BODY', text: 'Look {{1}}' },
    ],
  },
];

function fakeDb(
  receipts: Array<{ id: string; status: string; errors: unknown }> = [],
) {
  const collections = new Map<string, Array<Record<string, unknown>>>();
  const docs = (name: string) => {
    if (!collections.has(name)) collections.set(name, []);
    return collections.get(name)!;
  };
  const db = {
    ensureConnected: async () => true,
    query: async () => receipts,
    collection: (name: string) => ({
      find: (filter: Record<string, unknown>) => ({
        toArray: async () => docs(name).filter((doc) => matches(doc, filter)),
      }),
      insertOne: async (doc: Record<string, unknown>) => {
        const stored = { ...doc, _id: new ObjectId() };
        docs(name).push(stored);
        return { insertedId: stored._id };
      },
      updateOne: async (
        filter: Record<string, unknown>,
        update: { $set: Record<string, unknown> },
      ) => {
        const hit = docs(name).find((doc) => matches(doc, filter));
        if (hit) Object.assign(hit, update.$set);
        return { matchedCount: hit ? 1 : 0 };
      },
      deleteOne: async () => ({ deletedCount: 0 }),
    }),
  };
  return { db: db as unknown as DatabaseService, docs };
}

function graph(calls: Array<{ url: string; body: Record<string, unknown> }>) {
  return (async (url: string, init?: RequestInit) => {
    if (String(url).includes('message_templates')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ data: TEMPLATES }),
      } as Response;
    }
    const body = JSON.parse(String(init?.body || '{}')) as Record<
      string,
      unknown
    >;
    calls.push({ url: String(url), body });
    return {
      ok: true,
      status: 200,
      json: async () => ({ messages: [{ id: `wamid.${calls.length}` }] }),
    } as Response;
  }) as typeof fetch;
}

describe('message helpers', () => {
  it('offers only approved templates with body variables, and hides system alerts', () => {
    const list = sendableTemplates(TEMPLATES);
    expect(list.map((t) => t.name)).toEqual([
      'bday_wishes_en',
      'jv_mp_action_request',
    ]);
    expect(list[0]).toMatchObject({ params: ['name'], named: true });
    expect(list[1]).toMatchObject({
      params: ['1', '2', '3'],
      named: false,
      footer: 'JanaVignanam',
    });
  });

  it('fills templates, personalizes text, and cleans values Meta would refuse', () => {
    expect(fillTemplate('Hi {{name}}, re {{2}}', { name: 'Sravani' })).toBe(
      'Hi Sravani, re {{2}}',
    );
    expect(personalize('Dear {name}, meeting at 5', 'Sarojininaidu')).toBe(
      'Dear Sarojininaidu, meeting at 5',
    );
    expect(cleanParam(' line one\nline two\t     end ')).toBe(
      'line one line two   end',
    );
  });

  it('reads the delivery state and explains failures', () => {
    expect(bestState([])).toBe('accepted');
    expect(bestState(['sent', 'delivered'])).toBe('delivered');
    expect(bestState(['read', 'failed'])).toBe('failed');
    expect(deliveryError([{ code: 131047 }])).toContain('24 hours');
  });

  it('knows when the 24-hour free-text window is open', () => {
    const now = new Date('2026-09-30T10:00:00Z');
    expect(freeTextOpen(null, now)).toBe(false);
    expect(freeTextOpen('2026-09-29T11:00:00Z', now)).toBe(true);
    expect(freeTextOpen('2026-09-29T09:00:00Z', now)).toBe(false);
  });
});

describe('ContactMessagesService', () => {
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    ENV.forEach((key) => {
      saved[key] = process.env[key];
    });
    Object.assign(process.env, {
      WHATSAPP_ENABLED: 'true',
      WHATSAPP_ACCESS_TOKEN: 'token',
      WHATSAPP_PHONE_NUMBER_ID: '123',
      WHATSAPP_WABA_ID: '456',
    });
  });
  afterEach(() => {
    ENV.forEach((key) => {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    });
    setMutedSenders([]);
    setContactInboundRecorder(null);
  });

  async function setup(
    receipts: Array<{ id: string; status: string; errors: unknown }> = [],
  ) {
    const { db, docs } = fakeDb(receipts);
    const birthdays = new BirthdaysService(db);
    const a = await birthdays.create({
      name: 'Sarojininaidu',
      phone: '6281168530',
      birthday: '30-09',
    });
    const b = await birthdays.create({
      name: 'Udatha Sravani',
      phone: '8885230708',
      birthday: '30-09',
    });
    return {
      service: new ContactMessagesService(db, birthdays),
      birthdays,
      docs,
      a,
      b,
    };
  }

  it("sends typed text with each person's name and records it", async () => {
    const { service, docs, a, b } = await setup();
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    const results = await service.send(
      {
        contactIds: [a.id, b.id],
        kind: 'text',
        text: 'Dear {name}, the meeting is at 5 PM.',
      },
      graph(calls),
    );
    expect(results.map((r) => r.status)).toEqual(['accepted', 'accepted']);
    expect(calls.map((c) => (c.body.text as { body: string }).body)).toEqual([
      'Dear Sarojininaidu, the meeting is at 5 PM.',
      'Dear Udatha Sravani, the meeting is at 5 PM.',
    ]);
    expect(docs('contact_messages')).toHaveLength(2);
    expect(docs('contact_messages')[0]).toMatchObject({
      kind: 'text',
      messageId: 'wamid.1',
      status: 'accepted',
    });
  });

  it('fills {{name}} per person for named templates and sends positional ones in order', async () => {
    const { service, a, b } = await setup();
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    await service.send(
      {
        contactIds: [a.id, b.id],
        kind: 'template',
        template: 'bday_wishes_en',
        language: 'en',
      },
      graph(calls),
    );
    expect(
      calls.map(
        (c) =>
          (
            c.body.template as {
              components: Array<{
                parameters: Array<{ parameter_name: string; text: string }>;
              }>;
            }
          ).components[0].parameters[0],
      ),
    ).toEqual([
      { type: 'text', parameter_name: 'name', text: 'Sarojininaidu' },
      { type: 'text', parameter_name: 'name', text: 'Udatha Sravani' },
    ]);

    calls.length = 0;
    await service.send(
      {
        contactIds: [a.id],
        kind: 'template',
        template: 'jv_mp_action_request',
        params: { 1: 'Sir', 2: 'road\nwork', 3: 'R-12' },
      },
      graph(calls),
    );
    expect(
      (
        calls[0].body.template as {
          components: Array<{ parameters: Array<{ text: string }> }>;
        }
      ).components[0].parameters.map((p) => p.text),
    ).toEqual(['Sir', 'road work', 'R-12']);
  });

  it('refuses unknown templates, missing values, and empty text before sending anything', async () => {
    const { service, a } = await setup();
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    await expect(
      service.send(
        {
          contactIds: [a.id],
          kind: 'template',
          template: 'mediasphere_critical_issue',
        },
        graph(calls),
      ),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.send(
        {
          contactIds: [a.id],
          kind: 'template',
          template: 'jv_mp_action_request',
          params: { 1: 'Sir' },
        },
        graph(calls),
      ),
    ).rejects.toThrow('{{2}}');
    await expect(
      service.send(
        { contactIds: [a.id], kind: 'text', text: '  ' },
        graph(calls),
      ),
    ).rejects.toThrow(BadRequestException);
    expect(calls).toHaveLength(0);
  });

  it('shows delivery receipts, including why WhatsApp dropped a message', async () => {
    const { service, a, b } = await setup([
      { id: 'wamid.1', status: 'sent', errors: [] },
      { id: 'wamid.1', status: 'read', errors: [] },
      {
        id: 'wamid.2',
        status: 'failed',
        errors: [{ code: 131047, title: 'Re-engagement message' }],
      },
    ]);
    await service.send(
      { contactIds: [a.id, b.id], kind: 'text', text: 'Hello' },
      graph([]),
    );
    const history = await service.history();
    const byName = Object.fromEntries(history.map((row) => [row.name, row]));
    expect(byName.Sarojininaidu).toMatchObject({ state: 'read', error: null });
    expect(byName['Udatha Sravani'].state).toBe('failed');
    expect(byName['Udatha Sravani'].error).toContain('24 hours');
  });

  it('records when a one-way contact last wrote in, without the message', async () => {
    const { birthdays, docs } = await setup();
    birthdays.onModuleInit();
    await noteContactInbound(['918885230708']);
    const row = docs('birthday_contacts').find(
      (doc) => doc.name === 'Udatha Sravani',
    )!;
    expect(typeof row.lastInboundAt).toBe('string');
    expect(Object.keys(row)).not.toContain('lastInboundText');
    expect(
      docs('birthday_contacts').find((doc) => doc.name === 'Sarojininaidu')!
        .lastInboundAt,
    ).toBeNull();
  });
});
