import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import {
  contactRole,
  setStaffDirectory,
  staffRole,
} from '../whatsapp/whatsapp.audience';
import {
  setContactInboundRecorder,
  setMutedSenders,
} from '../whatsapp/whatsapp.muted';
import {
  isDue,
  maskPhone,
  normalizeContactPhone,
  parseBirthday,
  sendBirthdayWish,
  todayInIndia,
  whatsappSenderReady,
  type BirthdayContact,
  type WishLanguage,
  type WishRecord,
} from './birthdays';

const CONTACTS = 'birthday_contacts';
const RELOAD_RETRY_MS = 60_000;

export interface BirthdayInput {
  name: string;
  phone: string;
  /** Optional: people added only for messages have no birthday and get no wish. */
  birthday?: string;
  place?: string;
  designation?: string;
  notes?: string;
  language?: string;
}

export interface SendSummary {
  day: string;
  due: number;
  sent: number;
  failed: number;
}

function text(value: unknown, max: number): string {
  return typeof value === 'string'
    ? value.trim().replace(/\s+/g, ' ').slice(0, max)
    : '';
}

@Injectable()
export class BirthdaysService implements OnModuleInit {
  private readonly logger = new Logger(BirthdaysService.name);
  private sending = false;

  constructor(private readonly db: DatabaseService) {}

  /** Loads the one-way numbers so their replies are ignored from the first webhook on. */
  onModuleInit(): void {
    setContactInboundRecorder((phones) => this.noteInbound(phones));
    void this.refreshMuted();
  }

  async setReplies(
    id: string,
    allowReplies: boolean,
  ): Promise<BirthdayContact> {
    const doc = await this.findDoc(id);
    const contact = toContact(doc);
    const next = contact.role === 'user' ? allowReplies : true;
    if (next !== (doc.allowReplies === true)) {
      await this.db
        .collection(CONTACTS)
        .updateOne({ _id: doc._id }, { $set: { allowReplies: next } });
    }
    await this.refreshMuted();
    this.logger.log(
      `[BIRTHDAY] replies ${next ? 'allowed' : 'blocked'} for ${maskPhone(String(doc.phone || ''))}`,
    );
    return toContact({ ...doc, allowReplies: next });
  }

  async noteInbound(
    phones: string[],
    at = new Date().toISOString(),
  ): Promise<void> {
    await this.ready();
    const coll = this.db.collection(CONTACTS);
    for (const doc of await coll.find({}).toArray()) {
      if (phones.includes(String(doc.phone || '')))
        await coll.updateOne({ _id: doc._id }, { $set: { lastInboundAt: at } });
    }
  }

  async byIds(ids: string[]): Promise<BirthdayContact[]> {
    const wanted = new Set(ids);
    return (await this.contacts()).filter((contact) => wanted.has(contact.id));
  }

  async list(): Promise<BirthdayContact[]> {
    const contacts = await this.contacts();
    const today = todayInIndia();
    return contacts.sort(
      (a, b) =>
        upcoming(a.birthday, today).localeCompare(
          upcoming(b.birthday, today),
        ) || a.name.localeCompare(b.name),
    );
  }

  async create(input: BirthdayInput): Promise<BirthdayContact> {
    const name = text(input.name, 80);
    if (!name) throw new BadRequestException('Name is required.');
    const phone = normalizeContactPhone(input.phone);
    const { birthday, birthYear } = String(input.birthday || '').trim()
      ? parseBirthday(input.birthday || '')
      : { birthday: '', birthYear: null };
    const existing = await this.contacts();
    if (existing.some((contact) => contact.phone === phone)) {
      throw new ConflictException(
        'This phone number is already in the birthday list.',
      );
    }
    const doc: Record<string, unknown> = {
      name,
      phone,
      birthday,
      birthYear,
      place: text(input.place, 120),
      designation: text(input.designation, 120),
      notes: text(input.notes, 500),
      language: input.language === 'te' ? 'te' : 'en',
      createdAt: new Date().toISOString(),
      lastWish: null,
      lastInboundAt: null,
      allowReplies: false,
      role: 'user',
    };
    const inserted = await this.db.collection(CONTACTS).insertOne(doc);
    await this.refreshMuted();
    return toContact({ ...doc, _id: inserted.insertedId });
  }

  async remove(id: string): Promise<void> {
    const doc = await this.findDoc(id);
    await this.db.collection(CONTACTS).deleteOne({ _id: doc._id });
    await this.refreshMuted();
  }

  /** "Send now" from the admin page: sends even if already wished today. */
  async sendNow(id: string): Promise<BirthdayContact> {
    if (!whatsappSenderReady()) {
      throw new ServiceUnavailableException(
        'WhatsApp is not configured on the API (WHATSAPP_ENABLED, token, phone number ID).',
      );
    }
    const doc = await this.findDoc(id);
    const contact = toContact(doc);
    const wish = await this.wish(contact, todayInIndia(), true);
    if (wish.status === 'failed')
      throw new BadRequestException(
        `WhatsApp did not accept the message: ${wish.error}`,
      );
    return { ...contact, lastWish: wish };
  }

  /** Every contact whose birthday is today (India time) and who has not been wished yet. */
  async sendDue(
    fetchImpl: typeof fetch = fetch,
    now = new Date(),
  ): Promise<SendSummary> {
    const day = todayInIndia(now);
    const summary: SendSummary = { day, due: 0, sent: 0, failed: 0 };
    if (this.sending) return summary;
    this.sending = true;
    try {
      const due = (await this.contacts()).filter((contact) =>
        isDue(contact, day),
      );
      summary.due = due.length;
      for (const contact of due) {
        const wish = await this.wish(contact, day, false, fetchImpl);
        if (wish.status === 'sent') summary.sent += 1;
        else summary.failed += 1;
      }
      return summary;
    } finally {
      this.sending = false;
    }
  }

  async refreshMuted(): Promise<void> {
    try {
      await this.ready();
      const rows = await this.db.collection(CONTACTS).find({}).toArray();
      for (const doc of rows) {
        const role = contactRole(doc.role);
        if (role === 'user' || role === 'person' || doc.allowReplies === true)
          continue;
        await this.db
          .collection(CONTACTS)
          .updateOne({ _id: doc._id }, { $set: { allowReplies: true } });
        doc.allowReplies = true;
      }
      applyContactDirectory(rows);
    } catch (err) {
      this.logger.warn(
        `Could not load birthday contacts (${err instanceof Error ? err.message : 'database error'}); retrying in a minute.`,
      );
      setTimeout(() => void this.refreshMuted(), RELOAD_RETRY_MS).unref?.();
    }
  }

  private async wish(
    contact: BirthdayContact,
    day: string,
    manual: boolean,
    fetchImpl: typeof fetch = fetch,
  ): Promise<WishRecord> {
    const previous =
      contact.lastWish && contact.lastWish.day === day
        ? contact.lastWish.tries
        : 0;
    let wish: WishRecord;
    try {
      const sent = await sendBirthdayWish(contact, fetchImpl);
      wish = {
        day,
        status: 'sent',
        tries: previous + 1,
        at: new Date().toISOString(),
        messageId: sent.messageId,
        error: null,
        manual,
      };
      this.logger.log(
        `[BIRTHDAY] wished ${maskPhone(contact.phone)} (${contact.language})${manual ? ' manually' : ''}`,
      );
    } catch (err) {
      const error = (err instanceof Error ? err.message : String(err)).slice(
        0,
        300,
      );
      wish = {
        day,
        status: 'failed',
        tries: previous + 1,
        at: new Date().toISOString(),
        messageId: null,
        error,
        manual,
      };
      this.logger.error(
        `[BIRTHDAY] failed for ${maskPhone(contact.phone)}: ${error}`,
      );
    }
    const doc = await this.findDoc(contact.id);
    await this.db
      .collection(CONTACTS)
      .updateOne({ _id: doc._id }, { $set: { lastWish: wish } });
    return wish;
  }

  private async contacts(): Promise<BirthdayContact[]> {
    await this.ready();
    return (await this.db.collection(CONTACTS).find({}).toArray()).map(
      toContact,
    );
  }

  private async findDoc(id: string): Promise<Record<string, unknown>> {
    await this.ready();
    const doc = (await this.db.collection(CONTACTS).find({}).toArray()).find(
      (row) => String(row._id) === id,
    );
    if (!doc) throw new NotFoundException('Birthday contact not found');
    return doc;
  }

  private async ready(): Promise<void> {
    if (!(await this.db.ensureConnected()))
      throw new ServiceUnavailableException('Database is not connected');
  }
}

/** Sort key: days until the next birthday, so today's and the soonest come first. */
function upcoming(birthday: string, today: string): string {
  const current = today.slice(5);
  if (!birthday) return '2';
  return `${birthday >= current ? '0' : '1'}${birthday}`;
}

/** Reloads who may be answered and who is one-way, from the stored contacts. */
export function applyContactDirectory(
  rows: Array<Record<string, unknown>>,
): void {
  const contacts = rows.map(toContact);
  setStaffDirectory(
    rows.map((doc) => ({
      phone: String(doc.phone || ''),
      role: contactRole(doc.role),
      name: String(doc.name || ''),
    })),
  );
  const personPhones = new Set(
    rows
      .filter((doc) => contactRole(doc.role) === 'person')
      .map((doc) => String(doc.phone || '').replace(/\D/g, '')),
  );
  const answered = new Set(
    contacts
      .filter((contact) => contact.role !== 'user')
      .map((contact) => contact.phone.replace(/\D/g, '')),
  );
  setMutedSenders(
    contacts
      .filter((contact) => {
        const phone = contact.phone.replace(/\D/g, '');
        return (
          !personPhones.has(phone) &&
          !answered.has(phone) &&
          !contact.allowReplies
        );
      })
      .map((contact) => contact.phone),
    contacts.map((contact) => contact.phone),
  );
}

function toContact(doc: Record<string, unknown>): BirthdayContact {
  const wish =
    doc.lastWish && typeof doc.lastWish === 'object'
      ? (doc.lastWish as WishRecord)
      : null;
  return {
    id: String(doc._id),
    name: String(doc.name || ''),
    phone: String(doc.phone || ''),
    birthday: String(doc.birthday || ''),
    birthYear: typeof doc.birthYear === 'number' ? doc.birthYear : null,
    place: String(doc.place || ''),
    designation: String(doc.designation || ''),
    notes: String(doc.notes || ''),
    language: doc.language === 'te' ? 'te' : 'en',
    createdAt: String(doc.createdAt || ''),
    lastWish: wish,
    lastInboundAt: doc.lastInboundAt ? String(doc.lastInboundAt) : null,
    allowReplies:
      ['superadmin', 'admin', 'mp'].includes(contactRole(doc.role)) ||
      doc.allowReplies === true,
    role: contactRole(doc.role) === 'mp' ? 'mp' : staffRole(doc.role),
  };
}
