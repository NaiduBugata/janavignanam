import 'reflect-metadata';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import ExcelJS from 'exceljs';
import request from 'supertest';
import { AdminAuthService } from '../admin/auth/admin-auth.service';
import { AdminAuthGuard } from '../common/guards/admin-auth.guard';
import { DatabaseService } from '../database/database.service';
import { matches } from '../database/pg-collection';
import { ObjectId } from 'mongodb';
import { VisitsController } from './visits.controller';
import { VisitsService } from './visits.service';

const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(64, 0x20)]);

function fakeDb(): DatabaseService {
  const docs: Array<Record<string, unknown>> = [];
  const files = new Map<string, { name: string; mime: string; data: Buffer }>();
  return {
    ensureConnected: async () => true,
    query: async (sql: string, params: unknown[] = []) => {
      if (sql.includes('INSERT INTO mediasphere.visit_files')) {
        const [id, name, mime, , data] = params as [
          string,
          string,
          string,
          number,
          Buffer,
        ];
        files.set(id, { name, mime, data });
      }
      if (sql.includes('SELECT name, mime, data')) {
        const hit = files.get(String(params[0]));
        return hit ? [hit] : [];
      }
      if (sql.includes('DELETE FROM mediasphere.visit_files'))
        files.delete(String(params[0]));
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
  } as unknown as DatabaseService;
}

describe('Visits HTTP API', () => {
  let app: INestApplication;
  let token: string;

  beforeAll(async () => {
    const config = {
      get: (key: string) =>
        ({
          'admin.password': 'secret-pass',
          'admin.sessionSecret': 'test-secret',
        })[key],
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [VisitsController],
      providers: [
        VisitsService,
        AdminAuthService,
        AdminAuthGuard,
        { provide: ConfigService, useValue: config },
        { provide: DatabaseService, useValue: fakeDb() },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidUnknownValues: false,
      }),
    );
    await app.init();
    token = moduleRef.get(AdminAuthService).issueSessionToken().token;
  });

  afterAll(async () => {
    await app.close();
  });

  it('refuses uploads without an admin session', async () => {
    await request(app.getHttpServer())
      .post('/api/admin/visits')
      .field('title', 'x')
      .attach('file', PDF, 'visit.pdf')
      .expect(401);
  });

  it('uploads a PDF, lists it publicly, opens it inline, downloads it, and deletes it', async () => {
    const server = app.getHttpServer();
    const created = await request(server)
      .post('/api/admin/visits')
      .set('Authorization', `Bearer ${token}`)
      .field('title', 'Vinukonda school visit')
      .field('place', 'Vinukonda')
      .field('visitDate', '2026-09-27')
      .field('detail', 'Met teachers')
      .attach('file', PDF, 'Vinukonda visit.pdf')
      .expect(201);
    const visit = created.body.visit;
    expect(visit).toMatchObject({
      title: 'Vinukonda school visit',
      place: 'Vinukonda',
      file: { kind: 'pdf', name: 'Vinukonda visit.pdf' },
    });

    const list = await request(server).get('/api/visits').expect(200);
    expect(list.body.visits.map((row: { title: string }) => row.title)).toEqual(
      ['Vinukonda school visit'],
    );

    const inline = await request(server)
      .get(`/api/visits/files/${visit.file.id}`)
      .buffer(true)
      .expect(200);
    expect(inline.headers['content-type']).toBe('application/pdf');
    expect(inline.headers['content-disposition']).toMatch(
      /^inline; filename="Vinukonda visit.pdf"/,
    );
    expect(Buffer.from(inline.body).equals(PDF)).toBe(true);

    const download = await request(server)
      .get(`/api/visits/files/${visit.file.id}?download=1`)
      .expect(200);
    expect(download.headers['content-disposition']).toMatch(/^attachment;/);

    await request(server).delete(`/api/admin/visits/${visit.id}`).expect(401);
    await request(server)
      .delete(`/api/admin/visits/${visit.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const after = await request(server).get('/api/visits').expect(200);
    expect(after.body.visits).toEqual([]);
    await request(server).get(`/api/visits/files/${visit.file.id}`).expect(404);
  });

  it('serves the Excel and Word templates to anyone', async () => {
    const server = app.getHttpServer();
    const xlsx = await request(server)
      .get('/api/visits/template/xlsx')
      .responseType('blob')
      .expect(200);
    expect(xlsx.headers['content-disposition']).toBe(
      'attachment; filename="visits-template.xlsx"',
    );
    expect((xlsx.body as Buffer).subarray(0, 2).toString()).toBe('PK');
    const docx = await request(server)
      .get('/api/visits/template/docx')
      .responseType('blob')
      .expect(200);
    expect(docx.headers['content-type']).toContain('wordprocessingml');
    expect((docx.body as Buffer).subarray(0, 2).toString()).toBe('PK');
    await request(server).get('/api/visits/template/pdf').expect(404);
  });

  it('imports a visits file only for the admin', async () => {
    const server = app.getHttpServer();
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet('Visits').addRows([
      ['Date', 'Place', 'Purpose', 'Details'],
      ['01-10-2026', 'Sattenapalle', 'Grievance day', 'Collected 40 petitions'],
    ]);
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    await request(server)
      .post('/api/admin/visits/import')
      .attach('file', buffer, 'visits.xlsx')
      .expect(401);
    const res = await request(server)
      .post('/api/admin/visits/import')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', buffer, 'visits.xlsx')
      .expect(201);
    expect(res.body).toEqual({
      fileName: 'visits.xlsx',
      found: 1,
      imported: 1,
      duplicates: 0,
      rejected: [],
    });
    const list = await request(server).get('/api/visits').expect(200);
    expect(list.body.visits[0]).toMatchObject({
      title: 'Grievance day',
      place: 'Sattenapalle',
      file: null,
      source: 'import',
    });
  });

  it('rejects an image renamed to .pdf', async () => {
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(32),
    ]);
    const res = await request(app.getHttpServer())
      .post('/api/admin/visits')
      .set('Authorization', `Bearer ${token}`)
      .field('title', 'x')
      .attach('file', png, 'fake.pdf')
      .expect(400);
    expect(res.body.message).toMatch(/not a valid \.pdf/);
  });
});
