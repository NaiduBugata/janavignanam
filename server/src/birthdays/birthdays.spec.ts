import { BadRequestException, ConflictException } from '@nestjs/common';
import { ObjectId } from 'mongodb';
import { DatabaseService } from '../database/database.service';
import { matches } from '../database/pg-collection';
import { clearStaffDirectory } from '../whatsapp/whatsapp.audience';
import {
  contactSenders,
  isMutedSender,
  setMutedSenders,
  withoutMutedMessages,
} from '../whatsapp/whatsapp.muted';
import {
  birthdayWishesEnabled,
  isBirthdayOn,
  isDue,
  normalizeContactPhone,
  parseBirthday,
  sendBirthdayWish,
  wishHour,
  type BirthdayContact,
} from './birthdays';
import { BirthdaysSchedulerService } from './birthdays-scheduler.service';
import { BirthdaysService } from './birthdays.service';

const WA_ENV = [
  'WHATSAPP_ENABLED',
  'WHATSAPP_ACCESS_TOKEN',
  'WHATSAPP_PHONE_NUMBER_ID',
  'BIRTHDAY_WISHES_ENABLED',
  'BIRTHDAY_HOUR',
];

function fakeDb() {
  const docs: Array<Record<string, unknown>> = [];
  const db = {
    ensureConnected: async () => true,
    collection: () => ({
      find: (filter: Record<string, unknown>) => ({
        toArray: async () => docs.filter((doc) => matches(doc, filter)),
      }),
      insertOne: async (doc: Record<string, unknown>) => {
        const stored = { ...doc, _id: new ObjectId() };
        docs.push(stored);
        return { insertedId: stored._id };
      },
      updateOne: async (
        filter: Record<string, unknown>,
        update: { $set: Record<string, unknown> },
      ) => {
        const hit = docs.find((doc) => matches(doc, filter));
        if (hit) Object.assign(hit, update.$set);
        return { matchedCount: hit ? 1 : 0 };
      },
      deleteOne: async (filter: Record<string, unknown>) => {
        const index = docs.findIndex((doc) => matches(doc, filter));
        if (index >= 0) docs.splice(index, 1);
        return { deletedCount: index >= 0 ? 1 : 0 };
      },
    }),
  };
  return { db: db as unknown as DatabaseService, docs };
}

function graphFetch(
  calls: Array<Record<string, unknown>>,
  fail?: (body: Record<string, unknown>) => boolean,
) {
  return (async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body || '{}')) as Record<
      string,
      unknown
    >;
    calls.push(body);
    if (fail?.(body))
      return {
        ok: false,
        status: 400,
        json: async () => ({
          error: { message: 'Recipient not available', code: 131026 },
        }),
      } as Response;
    return {
      ok: true,
      status: 200,
      json: async () => ({ messages: [{ id: `wamid.${calls.length}` }] }),
    } as Response;
  }) as typeof fetch;
}

function contact(overrides: Partial<BirthdayContact> = {}): BirthdayContact {
  return {
    id: '1',
    name: 'Test',
    phone: '919000000001',
    birthday: '09-30',
    birthYear: null,
    place: '',
    designation: '',
    notes: '',
    language: 'en',
    createdAt: '',
    lastWish: null,
    lastInboundAt: null,
    allowReplies: false,
    role: 'user',
    ...overrides,
  };
}

describe('birthday rules', () => {
  const saved: Record<string, string | undefined> = {};
  beforeEach(() =>
    WA_ENV.forEach((key) => {
      saved[key] = process.env[key];
      delete process.env[key];
    }),
  );
  afterEach(() =>
    WA_ENV.forEach((key) => {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }),
  );

  it('adds the India country code to 10-digit mobiles and refuses bad numbers', () => {
    expect(normalizeContactPhone('62811 68530')).toBe('916281168530');
    expect(normalizeContactPhone('+91 88852-30708')).toBe('918885230708');
    expect(normalizeContactPhone('08885230708')).toBe('918885230708');
    expect(() => normalizeContactPhone('12345')).toThrow(BadRequestException);
  });

  it('reads birthdays with or without a year', () => {
    expect(parseBirthday('1995-09-30')).toEqual({
      birthday: '09-30',
      birthYear: 1995,
    });
    expect(parseBirthday('30-09-1995')).toEqual({
      birthday: '09-30',
      birthYear: 1995,
    });
    expect(parseBirthday('5/1')).toEqual({
      birthday: '01-05',
      birthYear: null,
    });
    expect(parseBirthday('29-02')).toEqual({
      birthday: '02-29',
      birthYear: null,
    });
    expect(() => parseBirthday('31-04-1990')).toThrow(BadRequestException);
    expect(() => parseBirthday('tomorrow')).toThrow(BadRequestException);
  });

  it('wishes 29 February birthdays on 28 February outside leap years', () => {
    expect(isBirthdayOn('09-30', '2026-09-30')).toBe(true);
    expect(isBirthdayOn('02-29', '2026-02-28')).toBe(true);
    expect(isBirthdayOn('02-29', '2028-02-28')).toBe(false);
    expect(isBirthdayOn('02-29', '2028-02-29')).toBe(true);
  });

  it('is due once a day, with up to three tries after failures', () => {
    const day = '2026-09-30';
    const wish = { day, at: '', messageId: null, error: null, manual: false };
    expect(isDue(contact(), day)).toBe(true);
    expect(isDue(contact({ birthday: '10-01' }), day)).toBe(false);
    expect(
      isDue(contact({ lastWish: { ...wish, status: 'sent', tries: 1 } }), day),
    ).toBe(false);
    expect(
      isDue(
        contact({ lastWish: { ...wish, status: 'failed', tries: 2 } }),
        day,
      ),
    ).toBe(true);
    expect(
      isDue(
        contact({ lastWish: { ...wish, status: 'failed', tries: 3 } }),
        day,
      ),
    ).toBe(false);
    expect(
      isDue(
        contact({
          lastWish: { ...wish, day: '2025-09-30', status: 'sent', tries: 1 },
        }),
        day,
      ),
    ).toBe(true);
    expect(isDue(contact({ birthday: '', name: 'Balaji' }), day)).toBe(false);
  });

  it('sends the approved template with the contact name as {{name}}', async () => {
    process.env.WHATSAPP_ACCESS_TOKEN = 'token';
    process.env.WHATSAPP_PHONE_NUMBER_ID = '123';
    const calls: Array<Record<string, unknown>> = [];
    await sendBirthdayWish(
      { name: 'Udatha Sravani', phone: '918885230708', language: 'en' },
      graphFetch(calls),
    );
    await sendBirthdayWish(
      { name: 'Sarojininaidu', phone: '916281168530', language: 'te' },
      graphFetch(calls),
    );
    expect(calls[0]).toMatchObject({
      to: '918885230708',
      type: 'template',
      template: {
        name: 'bday_wishes_en_mee',
        language: { code: 'en' },
        components: [
          {
            type: 'body',
            parameters: [
              { type: 'text', parameter_name: 'name', text: 'Udatha Sravani' },
            ],
          },
        ],
      },
    });
    expect(calls[1]).toMatchObject({
      template: { name: 'bday_wishes_mee', language: { code: 'te' } },
    });
  });

  it('sends the previous approved template while the new sign-off is still in review', async () => {
    process.env.WHATSAPP_ACCESS_TOKEN = 'token';
    process.env.WHATSAPP_PHONE_NUMBER_ID = '123';
    const calls: Array<Record<string, unknown>> = [];
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body || '{}')) as {
        template?: { name?: string };
      };
      calls.push(body);
      if (body.template?.name === 'bday_wishes_en_mee') {
        return {
          ok: false,
          status: 400,
          json: async () => ({
            error: { message: 'Template not approved', code: 132001 },
          }),
        } as Response;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ messages: [{ id: 'wamid.old' }] }),
      } as Response;
    }) as typeof fetch;
    const result = await sendBirthdayWish(
      { name: 'Ravi', phone: '919000000001', language: 'en' },
      fetchImpl,
    );
    expect(result.messageId).toBe('wamid.old');
    expect(
      calls.map((call) => (call.template as { name: string }).name),
    ).toEqual(['bday_wishes_en_mee', 'bday_wishes_en']);
  });

  it('runs wherever WhatsApp can send, unless BIRTHDAY_WISHES_ENABLED=false', () => {
    expect(birthdayWishesEnabled()).toBe(false);
    Object.assign(process.env, {
      WHATSAPP_ENABLED: 'true',
      WHATSAPP_ACCESS_TOKEN: 't',
      WHATSAPP_PHONE_NUMBER_ID: '1',
    });
    expect(birthdayWishesEnabled()).toBe(true);
    process.env.BIRTHDAY_WISHES_ENABLED = 'false';
    expect(birthdayWishesEnabled()).toBe(false);
    process.env.BIRTHDAY_WISHES_ENABLED = 'true';
    expect(birthdayWishesEnabled()).toBe(true);
  });

  it('starts at 7:00 India time unless BIRTHDAY_HOUR says otherwise', () => {
    expect(wishHour()).toBe(7);
    process.env.BIRTHDAY_HOUR = '9';
    expect(wishHour()).toBe(9);
    process.env.BIRTHDAY_HOUR = 'soon';
    expect(wishHour()).toBe(7);
  });
});

describe('BirthdaysService', () => {
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    WA_ENV.forEach((key) => {
      saved[key] = process.env[key];
    });
    Object.assign(process.env, {
      WHATSAPP_ENABLED: 'true',
      WHATSAPP_ACCESS_TOKEN: 'token',
      WHATSAPP_PHONE_NUMBER_ID: '123',
    });
  });
  afterEach(() => {
    WA_ENV.forEach((key) => {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    });
    setMutedSenders([]);
    clearStaffDirectory();
  });

  it("wishes only today's birthdays, once, and mutes every listed number", async () => {
    const { db, docs } = fakeDb();
    const service = new BirthdaysService(db);
    await service.create({
      name: 'Sarojininaidu',
      phone: '6281168530',
      birthday: '30-09',
      language: 'en',
    });
    await service.create({
      name: 'Udatha Sravani',
      phone: '8885230708',
      birthday: '1998-09-30',
    });
    await service.create({
      name: 'Later',
      phone: '9000000001',
      birthday: '01-10',
    });
    await expect(
      service.create({
        name: 'Copy',
        phone: '+91 62811 68530',
        birthday: '01-01',
      }),
    ).rejects.toThrow(ConflictException);
    const messageOnly = await service.create({
      name: 'Message only',
      phone: '9000000002',
    });
    expect(messageOnly).toMatchObject({ birthday: '', birthYear: null });
    expect(isMutedSender('919000000002')).toBe(true);
    expect(isMutedSender('916281168530')).toBe(true);
    expect(isMutedSender('918885230708')).toBe(true);

    const now = new Date('2026-09-30T04:00:00Z');
    const calls: Array<Record<string, unknown>> = [];
    expect(await service.sendDue(graphFetch(calls), now)).toEqual({
      day: '2026-09-30',
      due: 2,
      sent: 2,
      failed: 0,
    });
    const names = calls.map(
      (body) =>
        (
          body.template as {
            components: Array<{ parameters: Array<{ text: string }> }>;
          }
        ).components[0].parameters[0].text,
    );
    expect(names.sort()).toEqual(['Sarojininaidu', 'Udatha Sravani']);
    expect(await service.sendDue(graphFetch(calls), now)).toMatchObject({
      due: 0,
      sent: 0,
    });
    expect(calls).toHaveLength(2);
    expect(
      docs.find((doc) => doc.name === 'Sarojininaidu')?.lastWish,
    ).toMatchObject({ day: '2026-09-30', status: 'sent', tries: 1 });

    const list = await service.list();
    await service.remove(list.find((row) => row.name === 'Later')!.id);
    expect(isMutedSender('919000000001')).toBe(false);
  });

  it('lets a chosen contact reply while the others stay one-way', async () => {
    const { db, docs } = fakeDb();
    const service = new BirthdaysService(db);
    const saroj = await service.create({
      name: 'Sarojininaidu',
      phone: '6281168530',
      birthday: '30-09',
    });
    await service.create({
      name: 'Udatha Sravani',
      phone: '8885230708',
      birthday: '30-09',
    });
    expect(saroj.allowReplies).toBe(false);
    expect(isMutedSender('916281168530')).toBe(true);

    const updated = await service.setReplies(saroj.id, true);
    expect(updated.allowReplies).toBe(true);
    expect(docs.find((doc) => doc.name === 'Sarojininaidu')?.allowReplies).toBe(
      true,
    );
    expect(isMutedSender('916281168530')).toBe(false);
    expect(isMutedSender('918885230708')).toBe(true);

    const message = (from: string) => ({
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  { from, id: 'x', type: 'text', text: { body: 'hi' } },
                ],
              },
            },
          ],
        },
      ],
    });
    expect(contactSenders(message('916281168530'))).toEqual(['916281168530']);
    expect(withoutMutedMessages(message('916281168530')).dropped).toBe(0);
    expect(withoutMutedMessages(message('918885230708')).dropped).toBe(1);

    await service.setReplies(saroj.id, false);
    expect(isMutedSender('916281168530')).toBe(true);
  });

  it('does not block an admin or super admin when visits or birthday replies are turned off', async () => {
    const { db, docs } = fakeDb();
    const service = new BirthdaysService(db);
    const saroj = await service.create({
      name: 'Sarojininaidu',
      phone: '6281168530',
      birthday: '30-09',
    });
    const akshay = await service.create({
      name: 'Akshay Guptha',
      phone: '9000000026',
    });
    await service.create({
      name: 'Udatha Sravani',
      phone: '8885230708',
      birthday: '30-09',
    });
    const sarojDoc = docs.find((doc) => doc.name === 'Sarojininaidu');
    const akshayDoc = docs.find((doc) => doc.name === 'Akshay Guptha');
    if (sarojDoc) sarojDoc.role = 'superadmin';
    if (akshayDoc) akshayDoc.role = 'admin';
    await service.refreshMuted();

    const message = (from: string) => ({
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  { from, id: 'x', type: 'text', text: { body: 'hi' } },
                ],
              },
            },
          ],
        },
      ],
    });
    expect(isMutedSender('916281168530')).toBe(false);
    expect(isMutedSender('919000000026')).toBe(false);
    expect(withoutMutedMessages(message('916281168530')).dropped).toBe(0);
    expect(withoutMutedMessages(message('919000000026')).dropped).toBe(0);
    expect(withoutMutedMessages(message('918885230708')).dropped).toBe(1);

    expect((await service.setReplies(saroj.id, false)).allowReplies).toBe(true);
    expect((await service.setReplies(akshay.id, false)).allowReplies).toBe(
      true,
    );
    expect(sarojDoc?.allowReplies).toBe(true);
    expect(akshayDoc?.allowReplies).toBe(true);
    expect(isMutedSender('916281168530')).toBe(false);
    expect(isMutedSender('919000000026')).toBe(false);
    expect(isMutedSender('918885230708')).toBe(true);
  });

  it('does not mute a person phone when another row on that number is one-way', async () => {
    const { db, docs } = fakeDb();
    const service = new BirthdaysService(db);
    await service.create({
      name: 'Udatha Sravani',
      phone: '8885230708',
      birthday: '10-10',
    });
    docs[0].role = 'person';
    docs.push({
      _id: new ObjectId(),
      name: 'Sravani test',
      phone: '918885230708',
      birthday: '10-11',
      role: 'user',
      allowReplies: false,
    });
    await service.refreshMuted();
    const message = {
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  {
                    from: '918885230708',
                    id: 'x',
                    type: 'text',
                    text: { body: 'The road is broken' },
                  },
                ],
              },
            },
          ],
        },
      ],
    };
    expect(isMutedSender('918885230708')).toBe(false);
    expect(withoutMutedMessages(message).dropped).toBe(0);
  });

  it('records a failed wish and retries it on the next check', async () => {
    const { db, docs } = fakeDb();
    const service = new BirthdaysService(db);
    await service.create({
      name: 'Udatha Sravani',
      phone: '8885230708',
      birthday: '30-09',
    });
    const now = new Date('2026-09-30T04:00:00Z');
    const calls: Array<Record<string, unknown>> = [];
    expect(
      await service.sendDue(
        graphFetch(calls, () => true),
        now,
      ),
    ).toMatchObject({ due: 1, failed: 1 });
    expect(docs[0].lastWish).toMatchObject({ status: 'failed', tries: 1 });
    expect(String((docs[0].lastWish as { error: string }).error)).toContain(
      'Recipient not available',
    );
    expect(await service.sendDue(graphFetch(calls), now)).toMatchObject({
      due: 1,
      sent: 1,
    });
    expect(docs[0].lastWish).toMatchObject({ status: 'sent', tries: 2 });
  });

  it('only sends between 7:00 and 21:00 India time', async () => {
    delete process.env.BIRTHDAY_HOUR;
    const sendDue = jest.fn(async () => ({
      day: '',
      due: 0,
      sent: 0,
      failed: 0,
    }));
    const scheduler = new BirthdaysSchedulerService(
      {} as never,
      { sendDue } as unknown as BirthdaysService,
    );
    await scheduler.tick(new Date('2026-09-30T01:15:00Z'));
    expect(sendDue).not.toHaveBeenCalled();
    await scheduler.tick(new Date('2026-09-30T01:30:00Z'));
    expect(sendDue).toHaveBeenCalledTimes(1);
    await scheduler.tick(new Date('2026-09-30T15:30:00Z'));
    expect(sendDue).toHaveBeenCalledTimes(1);
  });
});

describe('one-way birthday numbers', () => {
  afterEach(() => setMutedSenders([]));

  const payload = (from: string, withStatus = false) => ({
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'waba',
        changes: [
          {
            field: 'messages',
            value: {
              metadata: { phone_number_id: '1' },
              contacts: [{ wa_id: from, profile: { name: 'Someone' } }],
              messages: [
                {
                  from,
                  id: 'wamid.in',
                  type: 'text',
                  text: { body: 'Thank you sir' },
                },
              ],
              ...(withStatus
                ? {
                    statuses: [
                      { id: 'wamid.out', status: 'read', recipient_id: from },
                    ],
                  }
                : {}),
            },
          },
        ],
      },
    ],
  });

  it('drops messages from listed numbers and leaves everyone else alone', () => {
    setMutedSenders(['916281168530']);
    const muted = withoutMutedMessages(payload('916281168530'));
    expect(muted.dropped).toBe(1);
    expect(muted.from).toEqual(['916281168530']);
    expect((muted.payload as { entry: unknown[] }).entry).toHaveLength(0);

    const other = payload('919999999999');
    expect(withoutMutedMessages(other)).toEqual({
      payload: other,
      dropped: 0,
      from: [],
    });
  });

  it('keeps delivery statuses that arrive with a dropped message', () => {
    setMutedSenders(['916281168530']);
    const result = withoutMutedMessages(payload('916281168530', true));
    const value = (
      result.payload as {
        entry: Array<{ changes: Array<{ value: Record<string, unknown[]> }> }>;
      }
    ).entry[0].changes[0].value;
    expect(value.messages).toEqual([]);
    expect(value.contacts).toEqual([]);
    expect(value.statuses).toHaveLength(1);
  });
});
