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

  const env: NodeJS.ProcessEnv = {
    WHATSAPP_ENABLED: 'true',
    WHATSAPP_ACCESS_TOKEN: 'test_token',
    WHATSAPP_PHONE_NUMBER_ID: '123456789',
    WHATSAPP_RECIPIENTS: adminPhone,
  };

  beforeEach(() => {
    sentBodies = [];
    mockFetch = jest.fn().mockImplementation(async (url, init) => {
      if (init && init.body) {
        sentBodies.push(JSON.parse(String(init.body)));
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ messages: [{ id: 'wamid_123' }] }),
      } as any;
    });

    mockWorkspace = {
      list: jest.fn().mockResolvedValue([sampleRecord]),
      get: jest.fn().mockResolvedValue(sampleRecord),
      saveProgress: jest.fn().mockResolvedValue(undefined),
    };

    service = new GrievanceProgressService(mockWorkspace);
  });

  describe('Event Detection & Keyword Matching', () => {
    it('detects gpm: interactive payload IDs', () => {
      const event = createMockEvent({ buttonId: 'gpm:menu' });
      expect(service.isGpmEvent(event, adminPhone)).toBe(true);
    });

    it('detects trigger keywords like #progress, progress, gpm', () => {
      for (const kw of GPM_TRIGGER_KEYWORDS) {
        const event = createMockEvent({ text: kw });
        expect(service.isGpmEvent(event, adminPhone)).toBe(true);
      }
    });

    it('ignores non-gpm events when there is no active session', () => {
      const event = createMockEvent({ text: 'Hello' });
      expect(service.isGpmEvent(event, adminPhone)).toBe(false);

      const menuEvent = createMockEvent({ text: 'news' });
      expect(service.isGpmEvent(menuEvent, adminPhone)).toBe(false);
    });
  });

  describe('Authorization Checks', () => {
    it('grants access to configured admin in WHATSAPP_RECIPIENTS', () => {
      const auth = service.checkAuthorization(adminPhone, env);
      expect(auth.authorized).toBe(true);
      expect(auth.role).toBe('admin');
    });

    it('denies access to unknown phone numbers', async () => {
      const event = createMockEvent({ sender: unauthorizedPhone, text: 'progress' });
      await service.handleEvent(event, unauthorizedPhone, mockFetch, env);

      expect(sentBodies.length).toBe(1);
      expect(sentBodies[0].text.body).toContain('Access Restricted');
      expect(mockWorkspace.list).not.toHaveBeenCalled();
    });
  });

  describe('Menu & Grievance Listing', () => {
    it('renders the Grievance Progress Manager main menu', async () => {
      const event = createMockEvent({ sender: adminPhone, text: 'progress' });
      await service.handleEvent(event, adminPhone, mockFetch, env);

      expect(sentBodies.length).toBe(1);
      const interactive = sentBodies[0].interactive;
      expect(interactive.type).toBe('list');
      expect(interactive.body.text).toContain('Grievance Progress Manager');

      const rowIds = interactive.action.sections[0].rows.map((r: any) => r.id);
      expect(rowIds).toContain('gpm:update');
      expect(rowIds).toContain('gpm:view');
      expect(rowIds).toContain('gpm:assigned');
      expect(rowIds).toContain('gpm:help');
    });

    it('lists authorized grievances with pagination support', async () => {
      const event = createMockEvent({ sender: adminPhone, listId: 'gpm:update' });
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

  describe('Complete Progress Update Workflow (Steps 1 to 8)', () => {
    it('executes full end-to-end stage update, note, confirmation and DB persistence', async () => {
      // 1. Select grievance to update
      const selEvent = createMockEvent({ sender: adminPhone, listId: `gpm:sel:${sampleRecord.id}:update` });
      await service.handleEvent(selEvent, adminPhone, mockFetch, env);

      expect(sentBodies.length).toBe(1);
      expect(sentBodies[0].interactive.type).toBe('list');
      expect(sentBodies[0].interactive.body.text).toContain('Update Progress Stage');

      // 2. Select stage 1 (Inspection)
      const stageEvent = createMockEvent({ sender: adminPhone, listId: `gpm:stg:${sampleRecord.id}:1` });
      await service.handleEvent(stageEvent, adminPhone, mockFetch, env);

      expect(sentBodies.length).toBe(2);
      expect(sentBodies[1].interactive.type).toBe('button');
      expect(sentBodies[1].interactive.body.text).toContain('Inspection');

      // 3. Select status 'Completed'
      const statusEvent = createMockEvent({ sender: adminPhone, buttonId: 'gpm:status:Completed' });
      await service.handleEvent(statusEvent, adminPhone, mockFetch, env);

      expect(sentBodies.length).toBe(3);
      expect(sentBodies[2].type).toBe('text');
      expect(sentBodies[2].text.body).toContain('Enter Progress Note');

      // 4. Enter progress note
      const noteEvent = createMockEvent({ sender: adminPhone, text: 'Site inspected by AE Ramesh. Leakage localized.' });
      await service.handleEvent(noteEvent, adminPhone, mockFetch, env);

      expect(sentBodies.length).toBe(4);
      expect(sentBodies[3].interactive.type).toBe('button');
      expect(sentBodies[3].interactive.body.text).toContain('Review Proposed Progress Update');
      expect(sentBodies[3].interactive.body.text).toContain('Inspection');
      expect(sentBodies[3].interactive.body.text).toContain('Site inspected by AE Ramesh');

      // 5. Confirm and Save
      const confirmEvent = createMockEvent({ sender: adminPhone, buttonId: 'gpm:confirm:yes' });
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

      // Verify success message sent with progress percentage
      expect(sentBodies.length).toBe(5);
      expect(sentBodies[4].interactive.type).toBe('button');
      expect(sentBodies[4].interactive.body.text).toContain('Progress Saved Successfully');
      expect(sentBodies[4].interactive.body.text).toContain('2 of 4 stages completed (50%)');
    });

    it('allows skipping the progress note when user types skip', async () => {
      // Setup session at ENTER_NOTE
      await service.handleEvent(createMockEvent({ sender: adminPhone, listId: `gpm:stg:${sampleRecord.id}:0` }), adminPhone, mockFetch, env);
      await service.handleEvent(createMockEvent({ sender: adminPhone, buttonId: 'gpm:status:In progress' }), adminPhone, mockFetch, env);

      // Reply with skip
      await service.handleEvent(createMockEvent({ sender: adminPhone, text: 'skip' }), adminPhone, mockFetch, env);

      const lastSent = sentBodies[sentBodies.length - 1];
      expect(lastSent.interactive.body.text).toContain('Review Proposed Progress Update');
      expect(lastSent.interactive.body.text).toContain('_(none)_');
    });

    it('cancels the update when user clicks Cancel or types cancel', async () => {
      // In middle of an update, user cancels
      const cancelEvent = createMockEvent({ sender: adminPhone, text: 'cancel' });
      await service.handleEvent(cancelEvent, adminPhone, mockFetch, env);

      expect(mockWorkspace.saveProgress).not.toHaveBeenCalled();
      const lastSent = sentBodies[sentBodies.length - 1];
      expect(lastSent.interactive.body.text).toContain('Progress update cancelled');
    });
  });

  describe('View Current Progress', () => {
    it('displays stage statuses, completion percentage and web fallback link', async () => {
      const viewEvent = createMockEvent({ sender: adminPhone, listId: `gpm:sel:${sampleRecord.id}:view` });
      await service.handleEvent(viewEvent, adminPhone, mockFetch, env);

      expect(sentBodies.length).toBe(1);
      const text = sentBodies[0].interactive.body.text;
      expect(text).toContain('Grievance Progress Details');
      expect(text).toContain('1 of 4 stages completed (25%)');
      expect(text).toContain('Work started: Completed');
      expect(text).toContain('Inspection: Pending');
      expect(text).toContain('https://janavignanam-three.vercel.app/progress/token_abc123xyz');
    });
  });

  describe('Help & Instructions', () => {
    it('provides clear walkthrough of workflow steps and commands', async () => {
      const helpEvent = createMockEvent({ sender: adminPhone, listId: 'gpm:help' });
      await service.handleEvent(helpEvent, adminPhone, mockFetch, env);

      expect(sentBodies.length).toBe(1);
      const body = sentBodies[0].interactive.body.text;
      expect(body).toContain('Grievance Progress Manager - Help');
      expect(body).toContain('Select status');
      expect(body).toContain('Confirm & Save');
    });
  });
});
