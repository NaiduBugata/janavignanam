import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { applyContactDirectory } from '../../birthdays/birthdays.service';
import { normalizeContactPhone } from '../../birthdays/birthdays';
import {
  demoProjectDocs,
  isDemoDataEnabled,
  isDemoDoc,
  setDemoDataEnabled,
} from '../demo-data';

const CONTACTS = 'birthday_contacts';
const RECORDS = 'jv_records';
const SETTINGS = 'app_settings';
const DEMO_KEY = 'demo-data';
export const MP_NAME = 'Sri Lavu Sri Krishna Devarayulu';

@Injectable()
export class AdminDeskService implements OnModuleInit {
  private readonly logger = new Logger(AdminDeskService.name);

  constructor(private readonly db: DatabaseService) {}

  async onModuleInit(): Promise<void> {
    try {
      if (!(await this.db.ensureConnected())) return;
      const saved = await this.db
        .collection(SETTINGS)
        .findOne({ key: DEMO_KEY });
      if (typeof saved?.enabled === 'boolean')
        setDemoDataEnabled(saved.enabled);
    } catch (err) {
      this.logger.warn(
        `Demo data setting was not loaded: ${err instanceof Error ? err.message : 'database error'}`,
      );
    }
  }

  demo() {
    return { enabled: isDemoDataEnabled() };
  }

  /** Sample rows for the admin switch. Empty while the switch is off. */
  async snapshot(): Promise<{ enabled: boolean; rows: DemoRow[] }> {
    const enabled = isDemoDataEnabled();
    if (!enabled) return { enabled, rows: [] };
    await this.ready();
    const stored = await this.db.collection(RECORDS).find({}).toArray();
    const docs = [...(Array.isArray(stored) ? stored : [])];
    if (
      !docs.some(
        (row) => String(row.section || '') === 'projects' && isDemoDoc(row),
      )
    ) {
      docs.push(...demoProjectDocs());
    }
    const rows = docs.filter((row) => isDemoDoc(row)).map(toDemoRow);
    return { enabled, rows };
  }

  async setDemo(enabled: boolean): Promise<{ enabled: boolean }> {
    await this.ready();
    setDemoDataEnabled(enabled);
    await this.db
      .collection(SETTINGS)
      .updateOne(
        { key: DEMO_KEY },
        { $set: { key: DEMO_KEY, enabled } },
        { upsert: true },
      );
    return { enabled };
  }

  async mpNumbers(): Promise<Array<{ id: string; phone: string }>> {
    await this.ready();
    return (await this.contacts())
      .filter((row) => row.mpAccess === true && row.role === 'mp')
      .map((row) => ({ id: String(row._id), phone: String(row.phone || '') }));
  }

  /** Saves this number as the MP and reloads who the bot answers, in this process. */
  async grantMp(phoneInput: string): Promise<{ id: string; phone: string }> {
    await this.ready();
    const phone = normalizeContactPhone(phoneInput);
    const rows = await this.contacts();
    const existing = rows.find((row) => digits(row.phone) === digits(phone));
    if (existing && existing.mpAccess !== true && existing.role !== 'user') {
      throw new ConflictException(
        'This number is already saved for someone else.',
      );
    }
    if (existing) {
      await this.db.collection(CONTACTS).updateOne(
        { _id: existing._id },
        {
          $set: {
            name: MP_NAME,
            role: 'mp',
            allowReplies: true,
            mpAccess: true,
          },
        },
      );
    } else {
      await this.db.collection(CONTACTS).insertOne({
        name: MP_NAME,
        phone,
        birthday: '',
        birthYear: null,
        place: '',
        designation: 'MP',
        notes: '',
        language: 'en',
        createdAt: new Date().toISOString(),
        lastWish: null,
        lastInboundAt: null,
        allowReplies: true,
        role: 'mp',
        mpAccess: true,
      });
    }
    await this.reloadDirectory();
    const saved = (await this.contacts()).find(
      (row) => digits(row.phone) === digits(phone),
    );
    if (!saved) throw new BadRequestException('The number was not saved.');
    this.logger.log(`MP access saved for ${mask(phone)}.`);
    return { id: String(saved._id), phone: String(saved.phone || '') };
  }

  async revokeMp(id: string): Promise<void> {
    await this.ready();
    const row = (await this.contacts()).find(
      (item) => String(item._id) === id && item.mpAccess === true,
    );
    if (!row) throw new NotFoundException('That MP number was not found.');
    await this.db.collection(CONTACTS).deleteOne({ _id: row._id });
    await this.reloadDirectory();
    this.logger.log(`MP access removed for ${mask(row.phone)}.`);
  }

  private async reloadDirectory(): Promise<void> {
    applyContactDirectory(await this.contacts());
  }

  private async contacts(): Promise<Array<Record<string, unknown>>> {
    return this.db.collection(CONTACTS).find({}).toArray();
  }

  private async ready(): Promise<void> {
    if (!(await this.db.ensureConnected()))
      throw new ServiceUnavailableException('Database is not connected');
  }
}

export interface DemoRow {
  section: string;
  title: string;
  detail: string;
  place: string;
  date: string;
}

function toDemoRow(row: Record<string, unknown>): DemoRow {
  return {
    section: String(row.section || ''),
    title: String(row.title || ''),
    detail: String(row.detail || '').slice(0, 180),
    place: String(row.place || ''),
    date: String(row.visitDate || row.createdAt || ''),
  };
}

function digits(value: unknown): string {
  return String(value || '').replace(/\D/g, '');
}

function mask(value: unknown): string {
  const phone = digits(value);
  if (phone.length < 4) return '(none)';
  return `${phone.slice(0, 2)}******${phone.slice(-2)}`;
}
