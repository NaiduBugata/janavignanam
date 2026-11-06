import { WorkspaceService } from './workspace.service';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../database/database.service';
import {
  setStaffDirectory,
  clearStaffDirectory,
} from '../whatsapp/whatsapp.audience';
import { defaultStages } from './progress-report';
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

  it('stores events, follow ups, schedules, and visits with designation', async () => {
    const records: Array<Record<string, unknown>> = [];
    const db = {
      ensureConnected: async () => true,
      collection: () => ({
        insertOne: async (doc: Record<string, unknown>) => {
          const _id = `rec-${records.length + 1}`;
          records.push({ ...doc, _id });
          return { insertedId: _id };
        },
        findOne: async (filter: { _id?: unknown }) =>
          records.find((row) => String(row._id) === String(filter._id)) ||
          null,
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
        find: (filter: { section?: string }) => ({
          sort: () => ({
            limit: () => ({
              toArray: async () =>
                records.filter(
                  (row) => !filter.section || row.section === filter.section,
                ),
            }),
          }),
        }),
      }),
    };
    const service = new WorkspaceService(
      db as unknown as DatabaseService,
      { get: () => 'test-secret' } as unknown as ConfigService,
    );

    const event = await service.create({
      section: 'events',
      title: 'Lakshmi',
      status: 'CMRF / Medical Assistance',
      createdBy: 'pa@janavignanam.com',
      fullName: 'Lakshmi',
      contactNumber: '9999999999',
      designation: 'Sarpanch',
      assemblyConstituency: 'Narasaraopet',
      village: 'Narasaraopet',
      mandal: 'Narasaraopet',
    });
    expect(event.section).toBe('events');
    expect(event.designation).toBe('Sarpanch');
    expect(event.status).toBe('CMRF / Medical Assistance');
    expect(event.progressToken).toBe('');

    const followup = await service.create({
      section: 'followups',
      createdBy: 'pa@janavignanam.com',
      fullName: 'Ravi',
      contactNumber: '9999999999',
      designation: 'Booth Incharge',
      followUpKind: 'frequent',
      village: 'Narasaraopet',
      mandal: 'Narasaraopet',
      assemblyConstituency: 'Narasaraopet',
      resolutionStatus: 'Pending',
    });
    expect(followup.section).toBe('followups');
    expect(followup.designation).toBe('Booth Incharge');
    expect(followup.followUpKind).toBe('frequent');

    const schedule = await service.create({
      section: 'schedules',
      title: 'Review roads',
      status: 'To do',
      createdBy: 'pa@janavignanam.com',
      place: 'Narasaraopet',
      visitDate: '2026-11-10',
      visitTime: '10:00',
      designation: 'AE',
      actionToBeTaken: 'Inspect the road',
      assemblyConstituency: 'Narasaraopet',
    });
    expect(schedule.section).toBe('schedules');
    expect(schedule.designation).toBe('AE');
    expect(schedule.actionToBeTaken).toBe('Inspect the road');

    const visit = await service.create({
      section: 'visits',
      title: 'Village visit',
      status: 'Visit',
      createdBy: 'pa@janavignanam.com',
      place: 'Chilakaluripet',
      visitDate: '2026-11-12',
      visitTime: '16:00',
      leadPhone: '9999999999',
      designation: 'Sarpanch',
    });
    expect(visit.section).toBe('visits');
    expect(visit.leadPhone).toBe('9999999999');

    expect(await service.list('events')).toHaveLength(1);
    expect(await service.list('followups')).toHaveLength(1);
    expect(await service.list('schedules')).toHaveLength(1);
    expect(await service.list('visits')).toHaveLength(1);

    const changed = await service.update(event.id, {
      title: 'Lakshmi',
      status: 'Housing',
      designation: 'President',
    });
    expect(changed.designation).toBe('President');
    expect(changed.status).toBe('Housing');
    await service.remove(event.id);
    expect(await service.list('events')).toHaveLength(0);
  });

  it('approves a grievance and dispatches native WhatsApp interactive buttons instead of external web links', async () => {
    const spyButtons = jest
      .spyOn(waSend, 'sendReplyList')
      .mockResolvedValue({ success: true });
    const spyTemplate = jest
      .spyOn(waSend, 'sendTemplateMessage')
      .mockResolvedValue({ success: true });
    const spyText = jest
      .spyOn(waSend, 'sendTextMessage')
      .mockResolvedValue({ success: true });

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
    expect(result.notice).toContain('any time');

    // Verify native interactive buttons dispatched
    expect(spyButtons).toHaveBeenCalledTimes(1);
    const [recipient, body, rows, options] = spyButtons.mock.calls[0];
    expect(recipient).toContain('8919537879');
    expect(body).toContain('UPDATE WORK PROGRESS');
    expect(body).toContain('Tap Update work and choose the progress.');
    expect(options).toEqual(expect.objectContaining({ button: 'Update work' }));
    expect(rows).toEqual([
      expect.objectContaining({
        id: 'dept:work:gr-water-1:pending',
        title: 'Pending',
      }),
      expect.objectContaining({
        id: 'dept:work:gr-water-1:started',
        title: 'Started',
      }),
      expect.objectContaining({
        id: 'dept:work:gr-water-1:progress',
        title: 'In progress',
      }),
      expect.objectContaining({
        id: 'dept:work:gr-water-1:needtime',
        title: 'Need time',
      }),
    ]);

    expect(spyTemplate).toHaveBeenCalledWith(
      expect.stringContaining('8919537879'),
      'jv_dept_work_update',
      expect.objectContaining({
        language: 'en',
        bodyParameters: [
          expect.any(String),
          expect.stringContaining('water'),
          expect.any(String),
          'Open',
        ],
      }),
    );

    spyButtons.mockRestore();
    spyTemplate.mockRestore();
    spyText.mockRestore();
  });

  it('does not send messages to leaders upon grievance approval and dispatches to associated department number', async () => {
    setStaffDirectory([
      { phone: '916304581226', role: 'admin', name: 'Akshay' },
      { phone: '919440123456', role: 'user', name: 'Ramesh' },
    ]);
    const spyButtons = jest
      .spyOn(waSend, 'sendReplyList')
      .mockResolvedValue({ success: true });
    const spyTemplate = jest
      .spyOn(waSend, 'sendTemplateMessage')
      .mockResolvedValue({ success: true });
    const spyText = jest
      .spyOn(waSend, 'sendTextMessage')
      .mockResolvedValue({ success: true });

    const records: Array<Record<string, unknown>> = [
      {
        _id: 'gr-officer-1',
        section: 'grievances',
        title: 'Water shortage in Chilakaluripet',
        detail: 'Need water supply repair immediately',
        status: 'Open',
        contactNumber: '919876543210',
        assignedOfficer: 'Akshay',
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

    const result = await service.approve('gr-officer-1');
    expect(result.record.status).toBe('Approved');

    // Leader was NOT messaged
    const allTextRecipients = spyText.mock.calls.map((c) => c[0]);
    expect(allTextRecipients).not.toContain('919440123456');

    // Department recipient list includes Akshay (916304581226)
    const buttonRecipients = spyButtons.mock.calls.map((c) => c[0]);
    expect(buttonRecipients).toContain('916304581226');
    expect(buttonRecipients).toContain('918919537879');
    expect(buttonRecipients).not.toContain('919440123456');

    spyButtons.mockRestore();
    spyTemplate.mockRestore();
    spyText.mockRestore();
    clearStaffDirectory();
  });

  it('keeps the grievance unapproved when the department number is not accepted', async () => {
    const spyButtons = jest
      .spyOn(waSend, 'sendReplyList')
      .mockRejectedValue(new Error('interactive failed'));
    const spyTemplate = jest
      .spyOn(waSend, 'sendTemplateMessage')
      .mockRejectedValue(new Error('template rejected'));
    const records: Array<Record<string, unknown>> = [
      {
        _id: 'gr-fail-1',
        section: 'grievances',
        title: 'Road damage',
        detail: 'Road is broken',
        status: 'Open',
        contactNumber: '919876543210',
      },
    ];
    const db = {
      ensureConnected: async () => true,
      articlesCollectionName: 'articles',
      collection: () => ({
        findOne: async (filter: { _id?: unknown }) =>
          records.find((row) => String(row._id) === String(filter._id)) || null,
        findOneAndUpdate: async () => {
          throw new Error('must not save');
        },
      }),
    };
    const service = new WorkspaceService(
      db as unknown as DatabaseService,
      { get: () => 'test-secret' } as unknown as ConfigService,
    );
    await expect(service.approve('gr-fail-1')).rejects.toThrow(
      'was not approved',
    );
    expect(records[0].status).toBe('Open');
    spyButtons.mockRestore();
    spyTemplate.mockRestore();
  });

  it('uses the approved template when the interactive department message is rejected', async () => {
    const spyButtons = jest
      .spyOn(waSend, 'sendReplyList')
      .mockRejectedValue(
        new waSend.WhatsAppSendError('Re-engagement required', 400, 131047),
      );
    const spyTemplate = jest
      .spyOn(waSend, 'sendTemplateMessage')
      .mockRejectedValueOnce(
        new waSend.WhatsAppSendError(
          'Template is pending and not approved',
          400,
          132001,
        ),
      )
      .mockResolvedValue({ messages: [{ id: 'wamid.dept.1' }] });
    jest.spyOn(waSend, 'sendTextMessage').mockResolvedValue({ success: true });
    const records: Array<Record<string, unknown>> = [
      {
        _id: 'gr-template-1',
        section: 'grievances',
        title: 'Water leak',
        detail: 'Need water supply',
        status: 'Open',
      },
    ];
    const db = {
      ensureConnected: async () => true,
      articlesCollectionName: 'articles',
      collection: () => ({
        findOne: async (filter: { _id?: unknown }) =>
          records.find((row) => String(row._id) === String(filter._id)) || null,
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
    const service = new WorkspaceService(
      db as unknown as DatabaseService,
      { get: () => 'test-secret' } as unknown as ConfigService,
    );
    const result = await service.approve('gr-template-1');
    expect(result.record.status).toBe('Approved');
    expect(result.notice).toContain('template');
    expect(spyTemplate).toHaveBeenCalledWith(
      expect.stringContaining('8919537879'),
      'jv_mp_action_request',
      expect.objectContaining({
        urlButton: expect.stringContaining('progress/'),
      }),
    );
    spyButtons.mockRestore();
    spyTemplate.mockRestore();
    jest.restoreAllMocks();
  });

  it('sends the department inbox once when the same number is configured twice', async () => {
    const previous = process.env.DEPARTMENT_PHONES;
    process.env.DEPARTMENT_PHONES = '918919537879,918919537879';
    const spyButtons = jest
      .spyOn(waSend, 'sendReplyList')
      .mockResolvedValue({ messages: [{ id: 'wamid.once' }] });
    const records: Array<Record<string, unknown>> = [
      {
        _id: 'gr-once-1',
        section: 'grievances',
        title: 'Light failure',
        detail: 'No electricity',
        status: 'Open',
        leadPhone: '919999999999',
      },
    ];
    const db = {
      ensureConnected: async () => true,
      articlesCollectionName: 'articles',
      collection: () => ({
        findOne: async (filter: { _id?: unknown }) =>
          records.find((row) => String(row._id) === String(filter._id)) || null,
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
    const service = new WorkspaceService(
      db as unknown as DatabaseService,
      { get: () => 'test-secret' } as unknown as ConfigService,
    );
    await service.approve('gr-once-1');
    const recipients = spyButtons.mock.calls.map((call) => call[0]);
    expect(recipients).toEqual(['918919537879']);
    spyButtons.mockRestore();
    if (previous === undefined) delete process.env.DEPARTMENT_PHONES;
    else process.env.DEPARTMENT_PHONES = previous;
  });

  it('does not message a leader number listed as the assigned officer', async () => {
    setStaffDirectory([
      { phone: '919440123456', role: 'user', name: 'Ramesh' },
    ]);
    const spyButtons = jest
      .spyOn(waSend, 'sendReplyList')
      .mockResolvedValue({ messages: [{ id: 'wamid.inbox' }] });
    const spyText = jest
      .spyOn(waSend, 'sendTextMessage')
      .mockResolvedValue({ success: true });
    const records: Array<Record<string, unknown>> = [
      {
        _id: 'gr-leader-1',
        section: 'grievances',
        title: 'Water leak near the tank',
        detail: 'Need water supply',
        status: 'Open',
        assignedOfficer: 'Ramesh',
        leadPhone: '919440123456',
      },
    ];
    const db = {
      ensureConnected: async () => true,
      articlesCollectionName: 'articles',
      collection: () => ({
        findOne: async (filter: { _id?: unknown }) =>
          records.find((row) => String(row._id) === String(filter._id)) || null,
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
    const service = new WorkspaceService(
      db as unknown as DatabaseService,
      { get: () => 'test-secret' } as unknown as ConfigService,
    );
    await service.approve('gr-leader-1');
    const recipients = [
      ...spyButtons.mock.calls.map((call) => call[0]),
      ...spyText.mock.calls.map((call) => call[0]),
    ];
    expect(recipients).not.toContain('919440123456');
    expect(spyButtons.mock.calls.map((call) => call[0])).toContain(
      '918919537879',
    );
    spyButtons.mockRestore();
    spyText.mockRestore();
    clearStaffDirectory();
  });

  it('notifies the citizen who raised the request once work is started', async () => {
    const spyTemplate = jest
      .spyOn(waSend, 'sendTemplateMessage')
      .mockResolvedValue({ messages: [{ id: 'wamid.work' }] });

    const testToken = 'ce42a89fab851611dc';
    const records: Array<Record<string, unknown>> = [
      {
        _id: 'gr-prog-1',
        section: 'grievances',
        title: 'Broken pipeline near market',
        detail: 'Pipeline leaking water',
        status: 'Approved',
        contactNumber: '918885230708',
        progressToken: testToken,
        progressStages: defaultStages(),
      },
    ];

    const db = {
      ensureConnected: async () => true,
      articlesCollectionName: 'articles',
      collection: () => ({
        findOne: async (filter: { _id?: unknown; progressToken?: unknown }) =>
          records.find(
            (r) =>
              (filter._id && String(r._id) === String(filter._id)) ||
              (filter.progressToken &&
                String(r.progressToken) === String(filter.progressToken)),
          ) || null,
        findOneAndUpdate: async (
          filter: { _id?: unknown; progressToken?: unknown },
          update: { $set?: Record<string, unknown> },
        ) => {
          const row = records.find(
            (r) =>
              (filter._id && String(r._id) === String(filter._id)) ||
              (filter.progressToken &&
                String(r.progressToken) === String(filter.progressToken)),
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

    // Update Stage 0 (Work started) from Pending to In progress
    const stages = defaultStages();
    stages[0] = {
      name: 'Work started',
      status: 'In progress',
      note: 'Team dispatched',
    };

    const updated = await service.saveProgress(testToken, {
      stages,
      remarks: 'Work commenced on site',
      department: 'Water supply',
    });

    expect(updated.status).toBe('In progress');
    expect(updated.workStartedNotifiedAt).toBeDefined();

    expect(spyTemplate).toHaveBeenCalledWith(
      expect.stringContaining('8885230708'),
      'jv_mp_action_request',
      expect.objectContaining({
        language: 'en',
        bodyParameters: [
          'Water supply',
          'Broken pipeline near market',
          'gr-prog-1',
          'Work Started',
        ],
        urlButton: `progress/${testToken}`,
      }),
    );

    // On subsequent progress update, citizen should NOT get duplicate notification
    spyTemplate.mockClear();
    stages[1] = {
      name: 'Inspection',
      status: 'In progress',
      note: 'Site inspected',
    };
    await service.saveProgress(testToken, { stages });
    expect(spyTemplate).not.toHaveBeenCalled();

    spyTemplate.mockRestore();
  });

  it('keeps a saved progress update when the work-started WhatsApp send fails', async () => {
    jest
      .spyOn(waSend, 'sendTemplateMessage')
      .mockRejectedValue(new Error('network down'));
    const testToken = 'ce42a89fab851611dd';
    const records: Array<Record<string, unknown>> = [
      {
        _id: 'gr-prog-fail',
        section: 'grievances',
        title: 'Broken pipeline near market',
        detail: 'Pipeline leaking water',
        status: 'Approved',
        contactNumber: '918885230708',
        progressToken: testToken,
        progressStages: defaultStages(),
      },
    ];
    const db = {
      ensureConnected: async () => true,
      articlesCollectionName: 'articles',
      collection: () => ({
        findOne: async (filter: { _id?: unknown; progressToken?: unknown }) =>
          records.find(
            (row) =>
              (filter._id && String(row._id) === String(filter._id)) ||
              (filter.progressToken &&
                String(row.progressToken) === String(filter.progressToken)),
          ) || null,
        findOneAndUpdate: async (
          filter: { _id?: unknown; progressToken?: unknown },
          update: { $set?: Record<string, unknown> },
        ) => {
          const row = records.find(
            (item) =>
              (filter._id && String(item._id) === String(filter._id)) ||
              (filter.progressToken &&
                String(item.progressToken) === String(filter.progressToken)),
          );
          if (!row) return null;
          Object.assign(row, update.$set || {});
          return row;
        },
      }),
    };
    const service = new WorkspaceService(
      db as unknown as DatabaseService,
      { get: () => 'test-secret' } as unknown as ConfigService,
    );
    const stages = defaultStages();
    stages[0] = {
      name: 'Work started',
      status: 'In progress',
      note: 'Crew out',
    };
    const updated = await service.saveProgress(testToken, {
      stages,
      department: 'Water supply',
    });
    expect(updated.status).toBe('In progress');
    expect(updated.workStartedNotifiedAt).toBe('');
    expect(records[0].status).toBe('In progress');
    jest.restoreAllMocks();
  });

  it('handles document upload, Grok scanning, storage, retrieval, and applying extracted details for grievances', async () => {
    const records: Array<Record<string, unknown>> = [
      {
        _id: 'gr_100',
        section: 'grievances',
        title: 'Pending grievance',
        detail: 'Initial citizen request',
        status: 'Open',
        createdAt: '2026-10-31T10:00:00.000Z',
      },
      {
        _id: 'proj_200',
        section: 'projects',
        title: 'Infrastructure project',
        detail: 'Road expansion',
        status: 'In progress',
        createdAt: '2026-10-31T10:00:00.000Z',
      },
    ];

    const db = {
      ensureConnected: async () => true,
      collection: () => ({
        findOne: async (filter: { _id?: unknown }) =>
          records.find((r) => String(r._id) === String(filter._id)) || null,
        findOneAndUpdate: async (
          filter: { _id?: unknown },
          update: { $set?: Record<string, unknown> },
        ) => {
          const row = records.find((r) => String(r._id) === String(filter._id));
          if (!row) return null;
          Object.assign(row, update.$set || {});
          return row;
        },
      }),
    };

    const mockGrokScanner = {
      isConfigured: () => true,
      scanDocument: jest.fn().mockResolvedValue({
        extractedText:
          '# Official Representation\nApplicant: Sunitha Rao\nLocation: Chilakaluripet',
        structuredData: {
          applicantName: 'Sunitha Rao',
          contactNumber: '9123456789',
          referenceNumber: 'PET/2026/55',
          date: '2026-10-20',
          category: 'Housing',
          village: 'Chilakaluripet',
          mandal: 'Chilakaluripet',
          division: 'Narasaraopet',
          assemblyConstituency: 'Chilakaluripet',
          actionRequested: 'Sanction housing scheme plot',
          issueSummary:
            'Request for allotment of housing site under government scheme',
        },
        modelUsed: 'grok-2-vision-1212',
        scannedAt: new Date().toISOString(),
      }),
    };

    const config = { get: () => 'test-secret' } as unknown as ConfigService;
    const service = new WorkspaceService(
      db as unknown as DatabaseService,
      config,
      mockGrokScanner as any,
    );

    // 1. Should reject non-grievance document uploads
    await expect(
      service.addDocumentToGrievance('proj_200', {
        buffer: Buffer.from('dummy-image'),
        originalname: 'site_photo.jpg',
        mimetype: 'image/jpeg',
        size: 11,
      }),
    ).rejects.toThrow('Document scanning is only supported for grievances');

    // 2. Successful document upload to grievance
    const uploadResult = await service.addDocumentToGrievance('gr_100', {
      buffer: Buffer.from('fake-pdf-content'),
      originalname: 'representation.pdf',
      mimetype: 'application/pdf',
      size: 16,
    });

    expect(uploadResult.document).toBeDefined();
    expect(uploadResult.document.filename).toBe('representation.pdf');
    expect(uploadResult.document.status).toBe('completed');
    expect(uploadResult.document.extractedText).toContain('Sunitha Rao');
    expect(uploadResult.document.structuredData?.referenceNumber).toBe(
      'PET/2026/55',
    );

    // Verify stored in record
    expect(uploadResult.record.scannedDocuments).toHaveLength(1);
    expect(uploadResult.record.scannedDocuments?.[0].id).toBe(
      uploadResult.document.id,
    );

    // 3. Retrieve document file
    const fileResult = await service.getDocumentFile(
      'gr_100',
      uploadResult.document.id,
    );
    expect(fileResult.filename).toBe('representation.pdf');
    expect(fileResult.mimeType).toBe('application/pdf');
    expect(fileResult.buffer.toString()).toBe('fake-pdf-content');

    // 4. Apply extracted data to grievance
    const appliedRecord = await service.applyExtractedDataToGrievance(
      'gr_100',
      uploadResult.document.id,
    );

    expect(appliedRecord.fullName).toBe('Sunitha Rao');
    expect(appliedRecord.contactNumber).toBe('9123456789');
    expect(appliedRecord.referenceNumber).toBe('PET/2026/55');
    expect(appliedRecord.dateOfVisit).toBe('2026-10-20');
    expect(appliedRecord.village).toBe('Chilakaluripet');
    expect(appliedRecord.actionToBeTaken).toBe('Sanction housing scheme plot');
    expect(appliedRecord.detail).toContain(
      '[Grok AI Extracted]: Request for allotment',
    );

    // 5. Remove document from grievance
    const recordAfterRemove = await service.removeDocumentFromGrievance(
      'gr_100',
      uploadResult.document.id,
    );
    expect(recordAfterRemove.scannedDocuments).toHaveLength(0);
  });
});
