import { BadRequestException } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { ObjectId } from 'mongodb';
import { DatabaseService } from '../database/database.service';
import { matches } from '../database/pg-collection';
import { VisitsService, detectVisitFile, safeFileName } from './visits.service';

const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(40)]);
const ZIP = Buffer.concat([
  Buffer.from([0x50, 0x4b, 0x03, 0x04]),
  Buffer.alloc(40),
]);
const OLE = Buffer.concat([
  Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
  Buffer.alloc(40),
]);
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(40),
]);

function fakeDb() {
  const docs: Array<Record<string, unknown>> = [];
  const files = new Map<
    string,
    { name: string; mime: string; size: number; data: Buffer }
  >();
  const queries: string[] = [];
  const db = {
    ensureConnected: async () => true,
    query: async (sql: string, params: unknown[] = []) => {
      queries.push(sql.trim().split(/\s+/).slice(0, 2).join(' '));
      if (sql.includes('INSERT INTO mediasphere.visit_files')) {
        const [id, name, mime, size, data] = params as [
          string,
          string,
          string,
          number,
          Buffer,
        ];
        files.set(id, { name, mime, size, data });
      } else if (sql.includes('SELECT name, mime, data')) {
        const hit = files.get(String(params[0]));
        return hit ? [hit] : [];
      } else if (sql.includes('DELETE FROM mediasphere.visit_files')) {
        files.delete(String(params[0]));
      }
      return [];
    },
    collection: () => ({
      find: (filter: Record<string, unknown>) => ({
        toArray: async () => docs.filter((doc) => matches(doc, filter)),
      }),
      insertOne: async (doc: Record<string, unknown>) => {
        const stored = { ...doc, _id: new ObjectId() };
        docs.push(stored);
        return { insertedId: stored._id };
      },
      insertMany: async (rows: Array<Record<string, unknown>>) => {
        const stored = rows.map((doc) => ({ ...doc, _id: new ObjectId() }));
        docs.push(...stored);
        return { insertedIds: stored.map((doc) => doc._id) };
      },
      deleteOne: async (filter: Record<string, unknown>) => {
        const index = docs.findIndex((doc) => matches(doc, filter));
        if (index >= 0) docs.splice(index, 1);
        return { deletedCount: index >= 0 ? 1 : 0 };
      },
    }),
  };
  return { db: db as unknown as DatabaseService, docs, files, queries };
}

describe('visit file checks', () => {
  it('accepts PDF, Word, and Excel when the contents match the extension', () => {
    expect(detectVisitFile('report.pdf', PDF)).toMatchObject({
      kind: 'pdf',
      mime: 'application/pdf',
    });
    expect(detectVisitFile('notes.DOCX', ZIP).kind).toBe('word');
    expect(detectVisitFile('old.doc', OLE).kind).toBe('word');
    expect(detectVisitFile('sheet.xlsx', ZIP).kind).toBe('excel');
    expect(detectVisitFile('sheet.xls', OLE).kind).toBe('excel');
  });

  it('refuses other types and renamed files', () => {
    expect(() => detectVisitFile('photo.png', PNG)).toThrow(
      BadRequestException,
    );
    expect(() => detectVisitFile('photo.pdf', PNG)).toThrow('not a valid .pdf');
    expect(() => detectVisitFile('script.exe', PDF)).toThrow(
      BadRequestException,
    );
    expect(() => detectVisitFile('pdf', PDF)).toThrow(BadRequestException);
  });

  it('strips paths and unsafe characters from file names', () => {
    expect(safeFileName('C:\\Users\\x\\Visit "Macherla".pdf')).toBe(
      'Visit _Macherla_.pdf',
    );
    expect(safeFileName('../../etc/passwd')).toBe('passwd');
  });
});

describe('VisitsService', () => {
  it('stores the file, lists newest visit first, serves the bytes, and deletes both', async () => {
    const { db, docs, files } = fakeDb();
    const service = new VisitsService(db);
    await service.create(
      { title: 'Older visit', visitDate: '2026-09-01' },
      { originalname: 'a.pdf', size: PDF.length, buffer: PDF },
    );
    const created = await service.create(
      {
        title: '  Macherla hospital visit ',
        place: 'Macherla',
        visitDate: '2026-09-28',
        detail: 'Reviewed new ward',
      },
      { originalname: 'Visit report.docx', size: ZIP.length, buffer: ZIP },
    );
    expect(created).toMatchObject({
      title: 'Macherla hospital visit',
      place: 'Macherla',
      visitDate: '2026-09-28',
      file: { name: 'Visit report.docx', kind: 'word', size: ZIP.length },
    });
    expect(docs[1]).toMatchObject({
      section: 'visits',
      status: 'Word',
      createdBy: 'admin',
    });

    const list = await service.list();
    expect(list.map((visit) => visit.title)).toEqual([
      'Macherla hospital visit',
      'Older visit',
    ]);

    const fileId = created.file!.id;
    const file = await service.file(fileId);
    expect(file.mime).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    expect(file.data.equals(ZIP)).toBe(true);

    await service.remove(created.id);
    expect(docs).toHaveLength(1);
    expect(files.has(fileId)).toBe(false);
  });

  it('lists hand-entered visits that have no file without inventing a download', async () => {
    const { db, docs } = fakeDb();
    docs.push({
      _id: new ObjectId(),
      section: 'visits',
      title: 'Village meeting',
      place: 'Chilakaluripet',
      createdAt: '2026-09-20T10:00:00.000Z',
    });
    docs.push({ _id: new ObjectId(), section: 'news', title: 'Not a visit' });
    const [visit, ...rest] = await new VisitsService(db).list();
    expect(rest).toEqual([]);
    expect(visit).toMatchObject({
      title: 'Village meeting',
      place: 'Chilakaluripet',
      file: null,
    });
  });

  it('keeps the lead number off the public list and on the admin list', async () => {
    const { db } = fakeDb();
    const service = new VisitsService(db);
    await service.create(
      {
        title: 'Hospital visit',
        visitDate: '2026-10-03',
        leadPhone: '98765 43210',
      },
      undefined,
    );
    const [pub] = await service.list();
    expect(pub).not.toHaveProperty('leadPhone');
    expect(pub).not.toHaveProperty('leadPhones');
    expect(JSON.stringify(pub)).not.toContain('9876543210');
    const [admin] = await service.listAdmin();
    expect(admin.leadPhone).toBe('919876543210');
    expect(admin.leadPhones).toEqual(['919876543210']);
  });

  it('saves a typed-in visit without a file', async () => {
    const { db, docs, files } = fakeDb();
    const visit = await new VisitsService(db).create(
      {
        title: 'Ward meeting',
        place: 'Narasaraopet',
        visitDate: '2026-09-25',
        visitTime: '14:30',
      },
      undefined,
    );
    expect(visit).toMatchObject({
      title: 'Ward meeting',
      place: 'Narasaraopet',
      visitDate: '2026-09-25',
      visitTime: '14:30',
      file: null,
      source: 'manual',
    });
    expect(docs[0]).toMatchObject({
      status: 'Manual',
      source: 'manual',
      visitTime: '14:30',
    });
    expect(docs[0]).not.toHaveProperty('file');
    expect(files.size).toBe(0);
  });

  it('orders visits on the same day by time, latest first', async () => {
    const { db } = fakeDb();
    const service = new VisitsService(db);
    await service.create(
      { title: 'Morning', visitDate: '2026-09-25', visitTime: '9:00 AM' },
      undefined,
    );
    await service.create(
      { title: 'Evening', visitDate: '2026-09-25', visitTime: '6 PM' },
      undefined,
    );
    await service.create(
      { title: 'No time', visitDate: '2026-09-25' },
      undefined,
    );
    const list = await service.list();
    expect(list.map((visit) => [visit.title, visit.visitTime])).toEqual([
      ['Evening', '18:00'],
      ['Morning', '09:00'],
      ['No time', ''],
    ]);
  });

  it('imports every row of a visits file, skips rows already on the site, and reports unreadable rows', async () => {
    const { db, docs } = fakeDb();
    const service = new VisitsService(db);
    await service.create(
      { title: 'Hospital visit', place: 'Vinukonda', visitDate: '2026-09-28' },
      undefined,
    );
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Visits');
    sheet.addRows([
      ['S.No', 'Date', 'Time', 'Place', 'Purpose / Title', 'Details'],
      [
        1,
        '28-09-2026',
        '',
        'vinukonda',
        'Hospital  visit',
        'already typed in by hand',
      ],
      [2, '30-09-2026', '11:15 AM', 'Macherla', 'Road review', 'Bypass works'],
      [
        3,
        '30-09-2026',
        '',
        'Macherla',
        'Road review',
        'same row twice in the file',
      ],
      [4, 'soon', '', 'Gurazala', 'Farmers meet', ''],
    ]);
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    const result = await service.importFile({
      originalname: 'September visits.xlsx',
      size: buffer.length,
      buffer,
    });
    expect(result).toEqual({
      fileName: 'September visits.xlsx',
      found: 3,
      imported: 1,
      duplicates: 2,
      rejected: [
        {
          where: 'Row 5',
          reason: 'Date "soon" is not a date like 28-09-2026.',
        },
      ],
    });
    expect(docs[1]).toMatchObject({
      section: 'visits',
      title: 'Road review',
      place: 'Macherla',
      visitDate: '2026-09-30',
      visitTime: '11:15',
      detail: 'Bypass works',
      status: 'From file',
      source: 'import',
      importFile: 'September visits.xlsx',
    });
    const list = await service.list();
    expect(list.map((visit) => [visit.title, visit.source])).toEqual([
      ['Road review', 'import'],
      ['Hospital visit', 'manual'],
    ]);

    const again = await service.importFile({
      originalname: 'September visits.xlsx',
      size: buffer.length,
      buffer,
    });
    expect(again).toMatchObject({ imported: 0, duplicates: 3 });
    expect(docs).toHaveLength(2);
  });

  it('refuses an import without a file or with an unsupported type', async () => {
    const service = new VisitsService(fakeDb().db);
    await expect(service.importFile(undefined)).rejects.toThrow(
      'Choose the Excel, Word, or PDF file',
    );
    await expect(
      service.importFile({
        originalname: 'photo.png',
        size: PNG.length,
        buffer: PNG,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects a missing title, a bad date, and an oversized file', async () => {
    const { db, files } = fakeDb();
    const service = new VisitsService(db);
    const pdf = { originalname: 'a.pdf', size: PDF.length, buffer: PDF };
    await expect(service.create({ title: '  ' }, pdf)).rejects.toThrow(
      'Title is required',
    );
    await expect(
      service.create({ title: 'x', visitDate: '28/09/2026' }, pdf),
    ).rejects.toThrow('Visit date');
    await expect(
      service.create({ title: 'x', visitTime: 'evening' }, pdf),
    ).rejects.toThrow('Visit time');
    await expect(
      service.create({ title: 'x' }, { ...pdf, size: 50 * 1024 * 1024 }),
    ).rejects.toThrow('larger than');
    expect(files.size).toBe(0);
  });

  it('returns not found for unknown ids', async () => {
    const service = new VisitsService(fakeDb().db);
    await expect(service.file('nope')).rejects.toThrow('File not found');
    await expect(service.file('a'.repeat(24))).rejects.toThrow(
      'File not found',
    );
    await expect(service.remove('missing')).rejects.toThrow('Visit not found');
  });
});
