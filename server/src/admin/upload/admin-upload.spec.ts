import { BadRequestException } from '@nestjs/common';
import { clearStaffDirectory } from '../../whatsapp/whatsapp.audience';
import { parseCsv, parseUpload, templateCsv } from './admin-upload';
import { AdminUploadService } from './admin-upload.service';
import type { DatabaseService } from '../../database/database.service';

function memoryDb(existing: Array<Record<string, unknown>> = []) {
  const inserted: Array<Record<string, unknown>> = [];
  const db = {
    ensureConnected: async () => true,
    collection: () => ({
      find: () => ({ toArray: async () => existing }),
      insertOne: async (doc: Record<string, unknown>) => {
        inserted.push(doc);
        return { insertedId: '1' };
      },
    }),
  };
  return { db: db as unknown as DatabaseService, inserted };
}

describe('admin upload format', () => {
  it('accepts a visits file that uses the template header', () => {
    const parsed = parseUpload('visits', parseCsv(templateCsv('visits')));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.rows[0]).toMatchObject({
      kind: 'visit',
      visitDate: '2026-09-29',
      visitTime: '10:30',
      title: 'Hospital visit',
    });
  });

  it('rejects a file whose header is not the template', () => {
    const parsed = parseUpload(
      'campaigns',
      parseCsv('Name,Notes\nCamp,Soon\n'),
    );
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.errors[0]).toContain('Title, Details, Status');
  });

  it('rejects a bad date and a bad priority without accepting the file', () => {
    const visits = parseUpload(
      'visits',
      parseCsv(
        'Date (DD-MM-YYYY),Time (10:30 AM),Place,Purpose / Title,Details,Lead phone (optional)\n32-13-2026,10:30 AM,Town,Visit,Notes,\n',
      ),
    );
    expect(visits.ok).toBe(false);
    const grievances = parseUpload(
      'grievances',
      parseCsv('Title,Details,Status,Priority\nWater,None,Open,urgent\n'),
    );
    expect(grievances.ok).toBe(false);
  });

  it('stores a schedule anytime row and a leader without a birthday', () => {
    const schedule = parseUpload('schedule', parseCsv(templateCsv('schedule')));
    expect(schedule.ok).toBe(true);
    if (schedule.ok)
      expect(schedule.rows[0]).toMatchObject({
        kind: 'visit',
        visitTime: '',
        title: 'Ward meeting',
      });
    const leaders = parseUpload('leaders', parseCsv(templateCsv('leaders')));
    expect(leaders.ok).toBe(true);
    if (leaders.ok)
      expect(leaders.rows[0]).toMatchObject({
        kind: 'contact',
        role: 'person',
        birthday: '',
      });
  });

  it('rejects a birthday row with no phone', () => {
    const parsed = parseUpload(
      'birthdays',
      parseCsv(
        'Name,Phone,Birthday (DD-MM or DD-MM-YYYY),Place,Designation,Notes,Language (en or te)\nRavi,,07-10,Town,Admin,,en\n',
      ),
    );
    expect(parsed.ok).toBe(false);
  });
});

describe('admin upload save', () => {
  afterEach(() => clearStaffDirectory());

  it('returns success only after a matching file is stored', async () => {
    const { db, inserted } = memoryDb();
    const result = await new AdminUploadService(db).save('campaigns', {
      originalname: 'campaigns.csv',
      buffer: Buffer.from(
        'Title,Details,Status\nDoor to door,Ward visits,Open\n',
      ),
    });
    expect(result).toEqual({
      status: 'success',
      kind: 'campaigns',
      inserted: 1,
    });
    expect(inserted).toEqual([
      expect.objectContaining({
        section: 'campaigns',
        title: 'Door to door',
        status: 'Open',
        source: 'upload',
      }),
    ]);
  });

  it('does not store anything when any row is outside the format', async () => {
    const { db, inserted } = memoryDb();
    const save = new AdminUploadService(db).save('campaigns', {
      originalname: 'campaigns.csv',
      buffer: Buffer.from(
        'Title,Details,Status\nDoor to door,Ward visits,Open\nYouth meeting,Sunday,Later\n',
      ),
    });
    await expect(save).rejects.toBeInstanceOf(BadRequestException);
    expect(inserted).toHaveLength(0);
  });
});
