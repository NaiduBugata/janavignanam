import {
  clearStaffDirectory,
  isMpPhone,
} from '../../whatsapp/whatsapp.audience';
import { isDemoDataEnabled, setDemoDataEnabled } from '../demo-data';
import { AdminDeskService } from './admin-desk.service';

function memoryDb() {
  const docs: Record<string, Array<Record<string, unknown>>> = {
    birthday_contacts: [],
    app_settings: [],
    jv_records: [],
  };
  const collection = (name: string) => ({
    find: () => ({ toArray: async () => docs[name] }),
    findOne: async (filter: Record<string, unknown>) =>
      docs[name].find((row) =>
        Object.entries(filter).every(([key, value]) => row[key] === value),
      ) || null,
    insertOne: async (doc: Record<string, unknown>) => {
      const _id = `${name}-${docs[name].length + 1}`;
      docs[name].push({ ...doc, _id });
      return { insertedId: _id };
    },
    updateOne: async (
      filter: Record<string, unknown>,
      update: { $set?: Record<string, unknown> },
    ) => {
      const hit = docs[name].find((row) =>
        Object.entries(filter).every(([key, value]) => row[key] === value),
      );
      if (hit) Object.assign(hit, update.$set || {});
      else
        docs[name].push({
          ...filter,
          ...(update.$set || {}),
          _id: `${name}-new`,
        });
      return { matchedCount: hit ? 1 : 0 };
    },
    deleteOne: async (filter: { _id?: unknown }) => {
      const index = docs[name].findIndex((row) => row._id === filter._id);
      if (index >= 0) docs[name].splice(index, 1);
      return { deletedCount: index >= 0 ? 1 : 0 };
    },
  });
  return {
    docs,
    db: { ensureConnected: async () => true, collection },
  };
}

describe('AdminDeskService', () => {
  afterEach(() => {
    clearStaffDirectory();
    setDemoDataEnabled(true);
  });

  it('gives the MP that number immediately and can take it away', async () => {
    const { db } = memoryDb();
    const desk = new AdminDeskService(db as never);
    const saved = await desk.grantMp('9100000099');
    expect(saved.phone).toBe('919100000099');
    expect(isMpPhone('919100000099')).toBe(true);
    await desk.revokeMp(saved.id);
    expect(isMpPhone('919100000099')).toBe(false);
    expect(await desk.mpNumbers()).toEqual([]);
  });

  it('does not replace a number that already belongs to someone else', async () => {
    const { docs, db } = memoryDb();
    docs.birthday_contacts.push({
      _id: 'admin-1',
      name: 'Akshay Guptha',
      phone: '919876543210',
      role: 'admin',
      allowReplies: true,
    });
    const desk = new AdminDeskService(db as never);
    await expect(desk.grantMp('919876543210')).rejects.toThrow('already saved');
    expect(isMpPhone('919876543210')).toBe(false);
  });

  it('stores the demo switch without removing any rows', async () => {
    const { db } = memoryDb();
    const desk = new AdminDeskService(db as never);
    expect(desk.demo().enabled).toBe(true);
    expect((await desk.setDemo(false)).enabled).toBe(false);
    expect(isDemoDataEnabled()).toBe(false);
    expect((await desk.setDemo(true)).enabled).toBe(true);
  });

  it('lists sample rows while the switch is on and none while it is off', async () => {
    const { docs, db } = memoryDb();
    docs.jv_records.push(
      {
        _id: 'mock-visit',
        section: 'visits',
        title: 'MOCK Morning review',
        detail: 'MOCK-VISIT',
        source: 'manual',
        visitDate: '2026-10-12',
      },
      {
        _id: 'real-visit',
        section: 'visits',
        title: 'Narasaraopet visit',
        detail: '',
        source: 'manual',
      },
    );
    const desk = new AdminDeskService(db as never);
    const on = await desk.snapshot();
    const titles = on.rows.map((row) => row.title);
    expect(on.enabled).toBe(true);
    expect(titles).toContain('MOCK Morning review');
    expect(titles).not.toContain('Narasaraopet visit');
    expect(
      on.rows.some(
        (row) =>
          row.section === 'projects' && row.title === 'Drinking water supply',
      ),
    ).toBe(true);
    await desk.setDemo(false);
    expect((await desk.snapshot()).rows).toEqual([]);
  });
});
