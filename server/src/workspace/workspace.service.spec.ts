import { WorkspaceService } from './workspace.service';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../database/database.service';
import * as waSend from '../whatsapp/whatsapp.send';

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

  it('approves a grievance and dispatches native WhatsApp interactive buttons instead of external web links', async () => {
    const spyButtons = jest
      .spyOn(waSend, 'sendReplyButtons')
      .mockResolvedValue({ success: true } as any);
    const spyTemplate = jest
      .spyOn(waSend, 'sendTemplateMessage')
      .mockResolvedValue({ success: true } as any);
    const spyText = jest
      .spyOn(waSend, 'sendTextMessage')
      .mockResolvedValue({ success: true } as any);

    const records: Array<Record<string, unknown>> = [
      {
        _id: 'gr-water-1',
        section: 'grievances',
        title: 'Water supply issue in Chilakaluripet',
        detail: 'Need water tanker service',
        village: 'Chilakaluripet',
        place: 'Chilakaluripet',
        status: 'Open',
        contactNumber: '919876543210',
      },
    ];

    const db = {
      ensureConnected: async () => true,
      articlesCollectionName: 'articles',
      collection: () => ({
        findOne: async (filter: { _id?: unknown }) =>
          records.find((r) => String(r._id) === String(filter._id)) || null,
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
      }),
    };
    const config = { get: () => 'test-secret' } as unknown as ConfigService;
    const service = new WorkspaceService(
      db as unknown as DatabaseService,
      config,
    );

    const result = await service.approve('gr-water-1');

    expect(result.record.status).toBe('Approved');
    expect(result.notice).toContain(
      'The department was sent the WhatsApp operations menu.',
    );

    // Verify native interactive buttons dispatched
    expect(spyButtons).toHaveBeenCalledTimes(1);
    const [recipient, body, buttons] = spyButtons.mock.calls[0];
    expect(recipient).toContain('8919537879');
    expect(body).toContain('DEPARTMENT OPERATIONS: ACTION REQUEST');
    expect(buttons).toHaveLength(3);
    expect(buttons[0]).toEqual({
      id: 'dept:g:up_pick:gr-water-1',
      title: 'Update Progress',
    });
    expect(buttons[1]).toEqual({
      id: 'dept:g:pick:gr-water-1',
      title: 'View Details',
    });
    expect(buttons[2]).toEqual({
      id: 'dept:menu',
      title: 'Department Menu',
    });

    // Verify template with URL button was NOT called because interactive buttons succeeded
    expect(spyTemplate).not.toHaveBeenCalled();

    spyButtons.mockRestore();
    spyTemplate.mockRestore();
    spyText.mockRestore();
  });
});
