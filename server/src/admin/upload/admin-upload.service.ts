import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import ExcelJS from 'exceljs';
import { applyContactDirectory } from '../../birthdays/birthdays.service';
import { DatabaseService } from '../../database/database.service';
import {
  isUploadKind,
  parseCsv,
  parseUpload,
  templateCsv,
  type UploadKind,
  type UploadRow,
} from './admin-upload';

const RECORDS = 'jv_records';
const CONTACTS = 'birthday_contacts';

@Injectable()
export class AdminUploadService {
  constructor(private readonly db: DatabaseService) {}

  template(kind: string): { filename: string; body: string } {
    if (!isUploadKind(kind))
      throw new BadRequestException('Unknown upload. Use the listed formats.');
    return { filename: `${kind}-template.csv`, body: templateCsv(kind) };
  }

  async save(
    kind: string,
    file: { originalname?: string; buffer?: Buffer } | undefined,
  ): Promise<{ status: 'success'; kind: UploadKind; inserted: number }> {
    if (!isUploadKind(kind))
      throw new BadRequestException('Unknown upload. Use the listed formats.');
    if (!file?.buffer?.length)
      throw new BadRequestException('Choose a .csv or .xlsx file.');
    const name = (file.originalname || '').toLowerCase();
    if (!name.endsWith('.csv') && !name.endsWith('.xlsx')) {
      throw new BadRequestException(
        'Upload a .csv or .xlsx file that uses the template.',
      );
    }
    const grid = name.endsWith('.xlsx')
      ? await excelGrid(file.buffer)
      : parseCsv(file.buffer.toString('utf8'));
    const parsed = parseUpload(kind, grid);
    if (!parsed.ok)
      throw new BadRequestException({
        status: 'failed',
        errors: parsed.errors,
      });
    await this.ready();
    await this.rejectKnownPhones(parsed.rows);
    const createdAt = new Date().toISOString();
    for (const row of parsed.rows) await this.insert(row, createdAt);
    if (parsed.rows.some((row) => row.kind === 'contact')) {
      applyContactDirectory(
        await this.db.collection(CONTACTS).find({}).toArray(),
      );
    }
    return { status: 'success', kind, inserted: parsed.rows.length };
  }

  private async rejectKnownPhones(rows: UploadRow[]): Promise<void> {
    const incoming = rows.filter((row) => row.kind === 'contact');
    if (!incoming.length) return;
    const existing = new Set(
      (await this.db.collection(CONTACTS).find({}).toArray()).map((doc) =>
        String(doc.phone || '').replace(/\D/g, ''),
      ),
    );
    const errors = incoming
      .filter((row) => existing.has(row.phone))
      .map((row) => `${row.name} already has this phone in the birthday list.`);
    if (errors.length)
      throw new BadRequestException({ status: 'failed', errors });
  }

  private async insert(row: UploadRow, createdAt: string): Promise<void> {
    if (row.kind === 'visit') {
      await this.db.collection(RECORDS).insertOne({
        section: 'visits',
        title: row.title,
        place: row.place,
        visitDate: row.visitDate,
        visitTime: row.visitTime,
        detail: row.detail,
        leadPhone: row.leadPhone,
        status: 'Manual',
        source: 'upload',
        createdAt,
        createdBy: 'admin',
        followUpSent: [],
      });
      return;
    }
    if (row.kind === 'record') {
      await this.db.collection(RECORDS).insertOne({
        section: row.section,
        title: row.title,
        detail: row.detail,
        status: row.status,
        ...(row.priority ? { priority: row.priority } : {}),
        createdAt,
        createdBy: 'admin',
        source: 'upload',
      });
      return;
    }
    await this.db.collection(CONTACTS).insertOne({
      name: row.name,
      phone: row.phone,
      birthday: row.birthday,
      birthYear: row.birthYear,
      place: row.place,
      designation: row.designation,
      notes: row.notes,
      language: row.language,
      createdAt,
      lastWish: null,
      lastInboundAt: null,
      allowReplies: false,
      role: row.role,
    });
  }

  private async ready(): Promise<void> {
    if (!(await this.db.ensureConnected()))
      throw new ServiceUnavailableException('Database is not connected');
  }
}

async function excelGrid(buffer: Buffer): Promise<string[][]> {
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(buffer as unknown as ArrayBuffer);
  const sheet = book.worksheets[0];
  if (!sheet) return [];
  const rows: string[][] = [];
  sheet.eachRow((row) => {
    const values = Array.isArray(row.values) ? row.values.slice(1) : [];
    rows.push(values.map(cellText));
  });
  return rows.filter((cells) => cells.some((value) => value !== ''));
}

function cellText(value: unknown): string {
  if (value == null) return '';
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${String(value.getDate()).padStart(2, '0')}-${String(value.getMonth() + 1).padStart(2, '0')}-${value.getFullYear()}`;
  }
  if (typeof value === 'object' && value && 'text' in value)
    return String(value.text).trim();
  return String(value).trim();
}
