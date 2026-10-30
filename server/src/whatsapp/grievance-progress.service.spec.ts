import {
  GrievanceProgressService,
  GPM_TRIGGER_KEYWORDS,
} from './grievance-progress.service';
import type { WorkspaceRecord } from '../workspace/workspace.service';
import type { WhatsAppEvent } from './whatsapp.parser';

function createMockEvent(opts: {
  sender?: string;
  messageId?: string;
  text?: string;
  buttonId?: string;
  listId?: string;
}): WhatsAppEvent {
  const sender = opts.sender || '919876543210';
  const id = opts.messageId || 'msg_' + Math.random().toString(36).slice(2);
  if (opts.buttonId) {
    return {
      event_category: 'message',
      event_type: 'button',
      sender_wa_id: sender,
      recipient_wa_id: '918000000000',
      message_id: id,
      timestamp: String(Date.now()),
      interactive_response: {
        button_reply: { id: opts.buttonId, title: 'Button' },
      },
      raw_payload: {},
    };
  }
  if (opts.listId) {
    return {
      event_category: 'message',
      event_type: 'interactive',
      sender_wa_id: sender,
      recipient_wa_id: '918000000000',
      message_id: id,
      timestamp: String(Date.now()),
      interactive_response: {
        list_reply: { id: opts.listId, title: 'List Item' },
      },
      raw_payload: {},
    };
  }
  return {
    event_category: 'message',
    event_type: 'text',
    sender_wa_id: sender,
    recipient_wa_id: '918000000000',
    message_id: id,
    timestamp: String(Date.now()),
    message_text: opts.text || '',
    raw_payload: {},
  };
}

describe('GrievanceProgressService', () => {
  let service: GrievanceProgressService;
  let mockWorkspace: any;
  let sentBodies: any[];
  let mockFetch: typeof fetch;

  const adminPhone = '919876543210';
  const unauthorizedPhone = '911111111111';

  const sampleRecord: WorkspaceRecord = {
    id: 'rec_101',
    section: 'grievances',
    title: 'Water pipe leakage in Main Bazaar',
    detail: 'Drinking water pipe has leaked for 3 days.',
    status: 'In progress',
    date: '2026-10-28',
    createdBy: 'Venkatesh Rao',
    followUpDepartment: 'Water supply',
    department: 'Water supply',
    place: 'Pedakurapadu',
    leader: 'Ramesh',
    srNumber: 'JV-GR-2026-0101',
    fullName: 'Venkatesh Rao',
    contactNumber: '919988776655',
    address: 'Main Bazaar, Pedakurapadu',
    email: '',
    progressToken: 'token_abc123xyz',
    progressStages: [
      { name: 'Work started', status: 'Completed', note: 'Staff dispatched' },
      { name: 'Inspection', status: 'Pending', note: '' },
      { name: 'Work in progress', status: 'Pending', note: '' },
      { name: 'Closing and handover', status: 'Pending', note: '' },
    ],
    progressRemarks: 'Staff dispatched',
    progressUpdatedAt: '2026-10-28T10:00:00.000Z',
    progressHistory: [],
  };

  const sampleRecord2: WorkspaceRecord = {
    id: 'rec_102',
    section: 'grievances',
    title: 'Street light repair in Market Road',
    detail: 'Street lights not working',
    status: 'Open',
    date: '2026-10-29',
    createdBy: 'Srinivas',
    followUpDepartment: 'Electricity',
    department: 'Electricity',
    place: 'Narasaraopet',
    leader: 'Suresh',
    srNumber: 'JV-GR-2026-0102',
    fullName: 'Srinivas',
    contactNumber: '919888776655',
    address: 'Market Road',
    email: '',
    progressToken: 'token_def456uvw',
    progressStages: [
      { name: 'Work started', status: 'Pending', note: '' },
      { name: 'Inspection', status: 'Pending', note: '' },
      { name: 'Work in progress', status: 'Pending', note: '' },
      { name: 'Closing and handover', status: 'Pending', note: '' },
    ],
    progressRemarks: '',
    progressUpdatedAt: '2026-10-29T10:00:00.000Z',
    progressHistory: [],
  };

  const env: NodeJS.ProcessEnv = {
    WHATSAPP_ENABLED: 'true',
    WHATSAPP_ACCESS_TOKEN: 'test_token',
    WHATSAPP_PHONE_NUMBER_ID: '123456789',
    WHATSAPP_RECIPIENTS: adminPhone,
  };

  beforeEach(() => {
    sentBodies = [];
    mockFetch = jest.fn(async (_url: any, init: any) => {
      const body = JSON.parse(init.body);
      sentBodies.push(body);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          messages: [
            { id: 'wamid_resp_' + Math.random().toString(36).slice(2) },
          ],
        }),
      } as any;
    });

    mockWorkspace = {
      list: jest.fn(async () => [sampleRecord, sampleRecord2]),
      get: jest.fn(async (id: string) => {
        if (id === sampleRecord.id) return sampleRecord;
        if (id === sampleRecord2.id) return sampleRecord2;
        return null;
      }),
      saveProgress: jest.fn(async () => {}),
    };

    service = new GrievanceProgressService(mockWorkspace);
  });

  describe('Event Detection & Keyword Matching', () => {
    it('detects gpm: interactive payload IDs', () => {
      const event = createMockEvent({ listId: 'gpm:update' });
      expect(service.isGpmEvent(event, adminPhone)).toBe(true);
    });

    it('detects trigger keywords like #progress, progress, gpm', () => {
      for (const kw of GPM_TRIGGER_KEYWORDS) {
        const event = createMockEvent({ text: kw });
        expect(service.isGpmEvent(event, adminPhone)).toBe(true);
      }
    });

    it('ignores non-gpm events when there is no active session', () => {
      const event = createMockEvent({
        text: 'Hello, what is the latest news?',
      });
      expect(service.isGpmEvent(event, adminPhone)).toBe(false);
    });
  });

  describe('Authorization Checks', () => {
    it('grants access to configured admin in WHATSAPP_RECIPIENTS', () => {
      const auth = service.checkAuthorization(adminPhone, env);
      expect(auth.authorized).toBe(true);
      expect(auth.role).toBe('admin');
    });

    it('denies access to unknown phone numbers', async () => {
      const event = createMockEvent({
        sender: unauthorizedPhone,
        text: 'progress',
      });
      await service.handleEvent(event, unauthorizedPhone, mockFetch, env);

      expect(sentBodies.length).toBe(1);
      expect(sentBodies[0].text.body).toContain('Access Restricted');
      expect(mockWorkspace.list).not.toHaveBeenCalled();
    });
  });

  describe('Menu & Grievance Listing', () => {
    it('renders the Grievance Progress Manager main menu with dedicated navigation', async () => {
      const event = createMockEvent({ sender: adminPhone, text: 'progress' });
      await service.handleEvent(event, adminPhone, mockFetch, env);

      expect(sentBodies.length).toBe(1);
      const interactive = sentBodies[0].interactive;
      expect(interactive.type).toBe('list');
      expect(interactive.body.text).toContain('Grievance Progress Manager');

      const rowIds = interactive.action.sections[0].rows.map((r: any) => r.id);
      expect(rowIds).toContain('gpm:assigned');
      expect(rowIds).toContain('gpm:update');
      expect(rowIds).toContain('gpm:view');
      expect(rowIds).toContain('gpm:search');
      expect(rowIds).toContain('gpm:help');
      expect(rowIds).toContain('home');
    });

    it('lists authorized grievances with pagination support', async () => {
      const event = createMockEvent({
        sender: adminPhone,
        listId: 'gpm:update',
      });
      await service.handleEvent(event, adminPhone, mockFetch, env);

      expect(mockWorkspace.list).toHaveBeenCalledWith('grievances');
      expect(sentBodies.length).toBe(1);
      const interactive = sentBodies[0].interactive;
      expect(interactive.type).toBe('list');
      expect(interactive.body.text).toContain('Select Grievance');

      const rows = interactive.action.sections[0].rows;
      expect(rows[0].id).toBe(`gpm:sel:${sampleRecord.id}:update`);
      expect(rows[0].description).toContain('Water supply');
    });
  });

  describe('Reference-Number Search', () => {
    it('finds and directly opens grievance when exact reference number is searched', async () => {
      // 1. Initiate search
      const searchInit = createMockEvent({
        sender: adminPhone,
        listId: 'gpm:search',
      });
      await service.handleEvent(searchInit, adminPhone, mockFetch, env);
      expect(sentBodies[0].text.body).toContain(
        'Search Grievances by Reference #',
      );

      // 2. Reply with SR Number
      const searchReply = createMockEvent({
        sender: adminPhone,
        text: 'JV-GR-2026-0101',
      });
      await service.handleEvent(searchReply, adminPhone, mockFetch, env);

      // Single match directly opens stage selector
      expect(sentBodies.length).toBe(2);
      expect(sentBodies[1].interactive.type).toBe('list');
      expect(sentBodies[1].interactive.body.text).toContain(
        'Update Progress Stage',
      );
      expect(sentBodies[1].interactive.body.text).toContain(
        'Water pipe leakage',
      );
    });

    it('displays filtered list when multiple records match query keyword', async () => {
      const searchInit = createMockEvent({
        sender: adminPhone,
        listId: 'gpm:search',
      });
      await service.handleEvent(searchInit, adminPhone, mockFetch, env);

      // Reply with common query "JV-GR"
      const searchReply = createMockEvent({
        sender: adminPhone,
        text: 'JV-GR',
      });
      await service.handleEvent(searchReply, adminPhone, mockFetch, env);

      expect(sentBodies.length).toBe(2);
      expect(sentBodies[1].interactive.type).toBe('list');
      expect(sentBodies[1].interactive.body.text).toContain('Filter: "JV-GR"');
      const rows = sentBodies[1].interactive.action.sections[0].rows;
      expect(rows.length).toBeGreaterThanOrEqual(2);
    });

    it('displays clear empty state when no records match search', async () => {
      const searchInit = createMockEvent({
        sender: adminPhone,
        listId: 'gpm:search',
      });
      await service.handleEvent(searchInit, adminPhone, mockFetch, env);

      const searchReply = createMockEvent({
        sender: adminPhone,
        text: 'nonexistent999',
      });
      await service.handleEvent(searchReply, adminPhone, mockFetch, env);

      expect(sentBodies.length).toBe(2);
      expect(sentBodies[1].interactive.type).toBe('button');
      expect(sentBodies[1].interactive.body.text).toContain(
        'No Grievances Found',
      );
    });
  });

  describe('Complete Progress Update Workflow (Steps 1 to 8)', () => {
    it('executes full end-to-end stage update, note, previous status, confirmation and DB persistence', async () => {
      // 1. Select grievance to update
      const selEvent = createMockEvent({
        sender: adminPhone,
        listId: `gpm:sel:${sampleRecord.id}:update`,
      });
      await service.handleEvent(selEvent, adminPhone, mockFetch, env);

      expect(sentBodies.length).toBe(1);
      expect(sentBodies[0].interactive.type).toBe('list');
      expect(sentBodies[0].interactive.body.text).toContain(
        'Update Progress Stage',
      );

      // 2. Select stage 1 (Inspection)
      const stageEvent = createMockEvent({
        sender: adminPhone,
        listId: `gpm:stg:${sampleRecord.id}:1`,
      });
      await service.handleEvent(stageEvent, adminPhone, mockFetch, env);

      expect(sentBodies.length).toBe(2);
      expect(sentBodies[1].interactive.type).toBe('button');
      expect(sentBodies[1].interactive.body.text).toContain('Inspection');

      // 3. Select status 'Completed'
      const statusEvent = createMockEvent({
        sender: adminPhone,
        buttonId: 'gpm:status:Completed',
      });
      await service.handleEvent(statusEvent, adminPhone, mockFetch, env);

      expect(sentBodies.length).toBe(3);
      expect(sentBodies[2].type).toBe('text');
      expect(sentBodies[2].text.body).toContain('Enter Progress Note');

      // 4. Enter progress note
      const noteEvent = createMockEvent({
        sender: adminPhone,
        text: 'Site inspected by AE Ramesh. Leakage localized.',
      });
      await service.handleEvent(noteEvent, adminPhone, mockFetch, env);

      expect(sentBodies.length).toBe(4);
      expect(sentBodies[3].interactive.type).toBe('button');
      const reviewText = sentBodies[3].interactive.body.text;
      expect(reviewText).toContain('Review Proposed Progress Update');
      expect(reviewText).toContain('Inspection');
      expect(reviewText).toContain('*Previous Status:* Pending');
      expect(reviewText).toContain('*Proposed Status:* *Completed*');
      expect(reviewText).toContain('Site inspected by AE Ramesh');

      // 5. Confirm and Save
      const confirmEvent = createMockEvent({
        sender: adminPhone,
        buttonId: 'gpm:confirm:yes',
      });
      await service.handleEvent(confirmEvent, adminPhone, mockFetch, env);

      // Verify WorkspaceService saveProgress was called with exact stages
      expect(mockWorkspace.saveProgress).toHaveBeenCalledTimes(1);
      const [token, input] = mockWorkspace.saveProgress.mock.calls[0];
      expect(token).toBe(sampleRecord.progressToken);
      expect(input.stages[1]).toEqual({
        name: 'Inspection',
        status: 'Completed',
        note: 'Site inspected by AE Ramesh. Leakage localized.',
      });
      expect(input.status).toBe('In progress');

      // Verify success message sent with progress percentage and bar
      expect(sentBodies.length).toBe(5);
      expect(sentBodies[4].interactive.type).toBe('button');
      expect(sentBodies[4].interactive.body.text).toContain(
        'Progress Saved Successfully',
      );
      expect(sentBodies[4].interactive.body.text).toContain(
        '2 of 4 stages completed (50%)',
      );
      expect(sentBodies[4].interactive.body.text).toContain('🟩🟩⬜⬜ 50%');
    });

    it('protects against duplicate webhook submission using idempotency control', async () => {
      // 1. Select grievance
      await service.handleEvent(
        createMockEvent({
          sender: adminPhone,
          listId: `gpm:sel:${sampleRecord.id}:update`,
        }),
        adminPhone,
        mockFetch,
        env,
      );
      // 2. Select stage 0 (Work started)
      await service.handleEvent(
        createMockEvent({
          sender: adminPhone,
          listId: `gpm:stg:${sampleRecord.id}:0`,
        }),
        adminPhone,
        mockFetch,
        env,
      );
      // 3. Status
      await service.handleEvent(
        createMockEvent({
          sender: adminPhone,
          buttonId: 'gpm:status:Completed',
        }),
        adminPhone,
        mockFetch,
        env,
      );
      // 4. Note
      await service.handleEvent(
        createMockEvent({ sender: adminPhone, text: 'Done' }),
        adminPhone,
        mockFetch,
        env,
      );
      // 5. First confirmation
      await service.handleEvent(
        createMockEvent({
          sender: adminPhone,
          buttonId: 'gpm:confirm:yes',
          messageId: 'msg_first',
        }),
        adminPhone,
        mockFetch,
        env,
      );

      expect(mockWorkspace.saveProgress).toHaveBeenCalledTimes(1);

      // 6. Duplicate delivery immediately after
      await service.handleEvent(
        createMockEvent({
          sender: adminPhone,
          buttonId: 'gpm:confirm:yes',
          messageId: 'msg_retry',
        }),
        adminPhone,
        mockFetch,
        env,
      );

      // Should not call saveProgress a second time
      expect(mockWorkspace.saveProgress).toHaveBeenCalledTimes(1);
    });

    it('allows skipping the progress note when user types skip', async () => {
      await service.handleEvent(
        createMockEvent({
          sender: adminPhone,
          listId: `gpm:stg:${sampleRecord.id}:0`,
        }),
        adminPhone,
        mockFetch,
        env,
      );
      await service.handleEvent(
        createMockEvent({
          sender: adminPhone,
          buttonId: 'gpm:status:In progress',
        }),
        adminPhone,
        mockFetch,
        env,
      );
      await service.handleEvent(
        createMockEvent({ sender: adminPhone, text: 'skip' }),
        adminPhone,
        mockFetch,
        env,
      );

      expect(sentBodies[2].interactive.body.text).toContain(
        'Review Proposed Progress Update',
      );
      expect(sentBodies[2].interactive.body.text).toContain('_(none)_');
    });

    it('cancels the update when user clicks Cancel or types cancel', async () => {
      await service.handleEvent(
        createMockEvent({
          sender: adminPhone,
          listId: `gpm:stg:${sampleRecord.id}:0`,
        }),
        adminPhone,
        mockFetch,
        env,
      );
      await service.handleEvent(
        createMockEvent({ sender: adminPhone, text: 'cancel' }),
        adminPhone,
        mockFetch,
        env,
      );

      expect(sentBodies[1].interactive.body.text).toContain(
        'Progress update cancelled',
      );
    });
  });

  describe('View Current Progress', () => {
    it('displays stage statuses, completion percentage and web fallback link', async () => {
      const event = createMockEvent({
        sender: adminPhone,
        listId: `gpm:sel:${sampleRecord.id}:view`,
      });
      await service.handleEvent(event, adminPhone, mockFetch, env);

      expect(sentBodies.length).toBe(1);
      const text = sentBodies[0].interactive.body.text;
      expect(text).toContain('Grievance Progress Details');
      expect(text).toContain('1 of 4 stages completed (25%)');
      expect(text).toContain('Work started: Completed');
      expect(text).toContain('Inspection: Pending');
      expect(text).toContain(
        'https://janavignanam-three.vercel.app/progress/token_abc123xyz',
      );
    });
  });

  describe('Help & Instructions', () => {
    it('provides clear walkthrough of workflow steps and commands', async () => {
      const event = createMockEvent({ sender: adminPhone, listId: 'gpm:help' });
      await service.handleEvent(event, adminPhone, mockFetch, env);

      expect(sentBodies.length).toBe(1);
      const body = sentBodies[0].interactive.body.text;
      expect(body).toContain('Grievance Progress Manager - Help');
      expect(body).toContain('Select status');
      expect(body).toContain('Confirm & Save');
    });
  });
});
