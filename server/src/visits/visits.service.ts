import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { isDemoDataEnabled, isDemoDoc } from '../admin/demo-data';
import { DatabaseService } from '../database/database.service';
import { normalizeContactPhone } from '../birthdays/birthdays';
import {
  parseVisitTime,
  readVisitRows,
  type ImportedVisitRow,
  type RejectedRow,
} from './visits-import';

/** Shared with the WhatsApp chatbot, which lists the same records under "Visits". */
const RECORDS = 'jv_records';
const SECTION = 'visits';

export type VisitFileKind = 'pdf' | 'word' | 'excel';

const TYPES: Record<
  string,
  { kind: VisitFileKind; mime: string; magic: 'pdf' | 'zip' | 'ole' }
> = {
  pdf: { kind: 'pdf', mime: 'application/pdf', magic: 'pdf' },
  doc: { kind: 'word', mime: 'application/msword', magic: 'ole' },
  docx: {
    kind: 'word',
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    magic: 'zip',
  },
  xls: { kind: 'excel', mime: 'application/vnd.ms-excel', magic: 'ole' },
  xlsx: {
    kind: 'excel',
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    magic: 'zip',
  },
};

const KIND_LABEL: Record<VisitFileKind, string> = {
  pdf: 'PDF',
  word: 'Word',
  excel: 'Excel',
};

export const VISIT_EXTENSIONS = Object.keys(TYPES);

export interface UploadedVisitFile {
  originalname: string;
  size: number;
  buffer: Buffer;
}

export interface VisitInput {
  title: string;
  place?: string;
  visitDate?: string;
  visitTime?: string;
  detail?: string;
  /** WhatsApp number of the visit lead. Stored for follow-up; omitted from the public list. */
  leadPhone?: string;
}

export interface Visit {
  id: string;
  title: string;
  place: string;
  visitDate: string;
  /** "HH:MM" or "HH:MM-HH:MM" in 24-hour time; '' when not given. */
  visitTime: string;
  detail: string;
  createdAt: string;
  file: { id: string; name: string; kind: VisitFileKind; size: number } | null;
  source: 'manual' | 'import';
}

/** Admin list only. The public visit list does not include these. */
export interface AdminVisit extends Visit {
  leadPhone: string;
  leadPhones: string[];
}

export interface ImportResult {
  fileName: string;
  found: number;
  imported: number;
  duplicates: number;
  rejected: RejectedRow[];
}

export function maxUploadBytes(env: NodeJS.ProcessEnv = process.env): number {
  const mb = Number(env.VISITS_MAX_UPLOAD_MB || '10');
  return Math.round((Number.isFinite(mb) && mb > 0 ? mb : 10) * 1024 * 1024);
}

/** Extension and file signature must agree, so a renamed executable or image is refused. */
export function detectVisitFile(
  name: string,
  buffer: Buffer,
): { ext: string; kind: VisitFileKind; mime: string } {
  const ext = (name.split('.').pop() || '').toLowerCase();
  const type = TYPES[ext];
  if (!type || !name.includes('.')) {
    throw new BadRequestException(
      'Only PDF, Word (.doc, .docx), or Excel (.xls, .xlsx) files can be uploaded.',
    );
  }
  const head = buffer.subarray(0, 8);
  const signature = {
    pdf: head.subarray(0, 5).toString('latin1') === '%PDF-',
    zip:
      head[0] === 0x50 &&
      head[1] === 0x4b &&
      head[2] === 0x03 &&
      head[3] === 0x04,
    ole: head.equals(
      Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
    ),
  };
  if (!signature[type.magic]) {
    throw new BadRequestException(`The file is not a valid .${ext} document.`);
  }
  return { ext, kind: type.kind, mime: type.mime };
}

export function safeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() || 'file';
  const cleaned = base
    .replace(/[\u0000-\u001f"<>:|?*]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
  return (cleaned || 'file').slice(0, 150);
}

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function isoDay(value: string | undefined): string {
  const day = (value || '').trim();
  if (!day) return '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(Date.parse(day))) {
    throw new BadRequestException('Visit date must be a date like 2026-09-29.');
  }
  return day;
}

function clock(value: string | undefined): string {
  const time = parseVisitTime(typeof value === 'string' ? value : '');
  if (time === null)
    throw new BadRequestException(
      'Visit time must be a time like 10:30 AM or 14:30.',
    );
  return time;
}

@Injectable()
export class VisitsService {
  private tableReady = false;

  constructor(private readonly db: DatabaseService) {}

  async list(): Promise<Visit[]> {
    return (await this.rows()).map((row) => toVisit(row));
  }

  async listAdmin(): Promise<AdminVisit[]> {
    return (await this.rows()).map((row) => toVisit(row, true));
  }

  private async rows(): Promise<Array<Record<string, unknown>>> {
    await this.ready();
    const rows = await this.db
      .collection(RECORDS)
      .find({ section: SECTION })
      .toArray();
    const visible = isDemoDataEnabled()
      ? rows
      : rows.filter((row) => !isDemoDoc(row));
    return visible.sort((a, b) =>
      sortKey(toVisit(b)).localeCompare(sortKey(toVisit(a))),
    );
  }

  /** A single visit typed in by hand; the attachment is optional. */
  async create(
    input: VisitInput,
    file: UploadedVisitFile | undefined,
  ): Promise<Visit> {
    const attached = file && file.buffer?.length ? file : undefined;
    if (attached) checkSize(attached);
    const title = text(input.title, 200);
    if (!title) throw new BadRequestException('Title is required.');
    const visitDate = isoDay(input.visitDate);
    const visitTime = clock(input.visitTime);
    const detected = attached
      ? detectVisitFile(attached.originalname || '', attached.buffer)
      : null;
    await this.ready();

    let stored: Visit['file'] = null;
    if (attached && detected) {
      const name = safeFileName(attached.originalname);
      const fileId = randomBytes(12).toString('hex');
      await this.db.query(
        'INSERT INTO mediasphere.visit_files (id, name, mime, size, data) VALUES ($1, $2, $3, $4, $5)',
        [fileId, name, detected.mime, attached.buffer.length, attached.buffer],
      );
      stored = {
        id: fileId,
        name,
        kind: detected.kind,
        size: attached.buffer.length,
      };
    }
    const doc: Record<string, unknown> = {
      section: SECTION,
      title,
      place: text(input.place, 120),
      visitDate,
      visitTime,
      detail: text(input.detail, 2000),
      leadPhone: leadPhone(input.leadPhone),
      status: detected ? KIND_LABEL[detected.kind] : 'Manual',
      source: 'manual',
      createdAt: new Date().toISOString(),
      createdBy: 'admin',
    };
    if (stored) doc.file = stored;
    try {
      const inserted = await this.db.collection(RECORDS).insertOne(doc);
      return toVisit({ ...doc, _id: inserted.insertedId }, true);
    } catch (err) {
      if (stored)
        await this.db
          .query('DELETE FROM mediasphere.visit_files WHERE id = $1', [
            stored.id,
          ])
          .catch(() => undefined);
      throw err;
    }
  }

  /** One file holding many visits: every table row becomes a visit, and rows already on the site are skipped. */
  async importFile(file: UploadedVisitFile | undefined): Promise<ImportResult> {
    if (!file || !file.buffer?.length)
      throw new BadRequestException(
        'Choose the Excel, Word, or PDF file that lists the visits.',
      );
    checkSize(file);
    const detected = detectVisitFile(file.originalname || '', file.buffer);
    const { rows, rejected } = await readVisitRows(
      detected.kind,
      detected.ext,
      file.buffer,
    );
    await this.ready();

    const coll = this.db.collection(RECORDS);
    const seen = new Set(
      (await coll.find({ section: SECTION }).toArray()).map((doc) =>
        visitKey(doc),
      ),
    );
    const fileName = safeFileName(file.originalname);
    const importedAt = new Date().toISOString();
    const fresh: Record<string, unknown>[] = [];
    let duplicates = 0;
    for (const row of rows) {
      const key = visitKey(row);
      if (seen.has(key)) {
        duplicates++;
        continue;
      }
      seen.add(key);
      fresh.push({
        section: SECTION,
        title: row.title,
        place: row.place,
        visitDate: row.visitDate,
        visitTime: row.visitTime,
        detail: row.detail,
        leadPhone: row.leadPhone,
        status: 'From file',
        source: 'import',
        importFile: fileName,
        createdAt: importedAt,
        createdBy: 'admin',
      });
    }
    await coll.insertMany(fresh);
    return {
      fileName,
      found: rows.length,
      imported: fresh.length,
      duplicates,
      rejected,
    };
  }

  async file(
    id: string,
  ): Promise<{ name: string; mime: string; data: Buffer }> {
    if (!/^[a-f0-9]{24}$/.test(id))
      throw new NotFoundException('File not found');
    await this.ready();
    const rows = await this.db.query<{
      name: string;
      mime: string;
      data: Buffer;
    }>('SELECT name, mime, data FROM mediasphere.visit_files WHERE id = $1', [
      id,
    ]);
    if (!rows.length) throw new NotFoundException('File not found');
    return rows[0];
  }

  async remove(id: string): Promise<void> {
    await this.ready();
    const coll = this.db.collection(RECORDS);
    const doc = (await coll.find({ section: SECTION }).toArray()).find(
      (row) => String(row._id) === id,
    );
    if (!doc) throw new NotFoundException('Visit not found');
    await coll.deleteOne({ _id: doc._id });
    const fileId = (doc.file as { id?: string } | undefined)?.id;
    if (fileId)
      await this.db.query('DELETE FROM mediasphere.visit_files WHERE id = $1', [
        fileId,
      ]);
  }

  private async ready(): Promise<void> {
    const ok = await this.db.ensureConnected();
    if (!ok) throw new ServiceUnavailableException('Database is not connected');
    if (this.tableReady) return;
    await this.db.query(`
      CREATE TABLE IF NOT EXISTS mediasphere.visit_files (
        id text PRIMARY KEY,
        name text NOT NULL,
        mime text NOT NULL,
        size integer NOT NULL,
        data bytea NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    this.tableReady = true;
  }
}

function checkSize(file: UploadedVisitFile): void {
  if (file.size > maxUploadBytes()) {
    throw new BadRequestException(
      `The file is larger than ${Math.round(maxUploadBytes() / 1024 / 1024)} MB.`,
    );
  }
}

/** Same date, place, and title (ignoring case and spacing) means the same visit. */
function visitKey(row: Record<string, unknown> | ImportedVisitRow): string {
  const part = (value: unknown) =>
    String(value || '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  return [part(row.visitDate), part(row.place), part(row.title)].join('|');
}

function sortKey(visit: Visit): string {
  return `${visit.visitDate || visit.createdAt.slice(0, 10)}|${visit.visitTime}|${visit.createdAt}`;
}

function leadPhone(value: string | undefined): string {
  const raw = (value || '').trim();
  return raw ? normalizeContactPhone(raw) : '';
}

function toVisit(doc: Record<string, unknown>): Visit;
function toVisit(doc: Record<string, unknown>, includePhone: true): AdminVisit;
function toVisit(
  doc: Record<string, unknown>,
  includePhone = false,
): Visit | AdminVisit {
  const file = (doc.file || {}) as Record<string, unknown>;
  const kind = (
    ['pdf', 'word', 'excel'].includes(String(file.kind)) ? file.kind : 'pdf'
  ) as VisitFileKind;
  const visit: Visit = {
    id: String(doc._id),
    title: String(doc.title || ''),
    place: String(doc.place || ''),
    visitDate: String(doc.visitDate || ''),
    visitTime: String(doc.visitTime || ''),
    detail: String(doc.detail || ''),
    createdAt: String(doc.createdAt || ''),
    file: file.id
      ? {
          id: String(file.id),
          name: String(file.name || ''),
          kind,
          size: Number(file.size || 0),
        }
      : null,
    source: doc.source === 'import' ? 'import' : 'manual',
  };
  if (!includePhone) return visit;
  const leadPhones = Array.isArray(doc.leadPhones)
    ? doc.leadPhones.map((phone) => String(phone || '')).filter(Boolean)
    : [];
  const leadPhone = String(doc.leadPhone || '');
  return {
    ...visit,
    leadPhone,
    leadPhones: leadPhones.length ? leadPhones : leadPhone ? [leadPhone] : [],
  };
}
