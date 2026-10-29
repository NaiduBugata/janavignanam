import { WorkspaceService } from './workspace.service';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../database/database.service';

describe('WorkspaceService', () => {
  it('registers, logs in, and stores a grievance without a live database', async () => {
    const users: Array<Record<string, unknown>> = [];
    const records: Array<Record<string, unknown>> = [];
    const db = {
      ensureConnected: async () => true,
      articlesCollectionName: 'articles',
      collection: (name: string) => ({
        findOne: async (filter: { email?: string; _id?: unknown }) => {
          const rows = name === 'jv_users' ? users : records;
          return (
            rows.find((row) =>
              filter.email != null
                ? row.email === filter.email
                : String(row._id) === String(filter._id),
            ) || null
          );
        },
        findOneAndUpdate: async (
          filter: { _id?: unknown },
          update: { $set?: Record<string, unknown> },
        ) => {
          const row = records.find(
            (item) => String(item._id) === String(filter._id),
          );
          if (!row) return null;
          Object.assign(row, update.$set || {});
          return row;
        },
        deleteOne: async (filter: { _id?: unknown }) => {
          const index = records.findIndex(
            (item) => String(item._id) === String(filter._id),
          );
          if (index < 0) return { deletedCount: 0 };
          records.splice(index, 1);
          return { deletedCount: 1 };
        },
        insertOne: async (doc: Record<string, unknown>) => {
          const _id = `${name}-${(name === 'jv_users' ? users : records).length + 1}`;
          const row = { ...doc, _id };
          (name === 'jv_users' ? users : records).push(row);
          return { insertedId: _id };
        },
        find: () => ({
          sort: () => ({
            limit: () => ({
              toArray: async () =>
                records.filter((row) => row.section === 'grievances'),
            }),
          }),
        }),
        countDocuments: async (filter: { section?: string }) =>
          records.filter(
            (row) => !filter.section || row.section === filter.section,
          ).length,
      }),
    };
    const config = { get: () => 'test-secret' } as unknown as ConfigService;
    const service = new WorkspaceService(
      db as unknown as DatabaseService,
      config,
    );

    const created = await service.register(
      'local@janavignanam.local',
      'localpass',
      'local',
    );
    expect(created.user.email).toBe('local@janavignanam.local');
    const again = await service.login('local@janavignanam.local', 'localpass');
    expect(again.user.name).toBe('local');
    await expect(
      service.login('local@janavignanam.local', 'wrongpass'),
    ).rejects.toThrow('incorrect');

    const row = await service.create({
      section: 'grievances',
      title: 'Water supply',
      detail: 'Ward 14',
      createdBy: again.user.email,
      fullName: 'Lakshmi',
      village: 'Chilakaluripet',
      categories: ['Water'],
      resolutionStatus: 'Pending',
    });
    expect(row.title).toBe('Lakshmi');
    expect(row.progressToken).toHaveLength(18);
    expect(row.fullName).toBe('Lakshmi');
    expect(row.village).toBe('Chilakaluripet');
    expect(row.status).toBe('Pending');
    expect(await service.list('grievances')).toHaveLength(1);

    const updated = await service.update(row.id, {
      fullName: 'Lakshmi Rao',
      resolutionStatus: 'Resolved',
      categories: ['Water'],
      village: 'Chilakaluripet',
    });
    expect(updated.fullName).toBe('Lakshmi Rao');
    expect(updated.status).toBe('Resolved');
    await service.remove(row.id);
    expect(await service.list('grievances')).toHaveLength(0);

    const campaign = await service.create({
      section: 'campaigns',
      title: 'Door to door',
      detail: 'Narasaraopet ward visits this week.',
      status: 'Open',
      createdBy: again.user.email,
    });
    expect(campaign.title).toBe('Door to door');
    expect(campaign.detail).toBe('Narasaraopet ward visits this week.');
    expect(campaign.progressToken).toBe('');
  });
});
