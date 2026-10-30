import {
  DepartmentOperationsService,
  DEPT_TRIGGER_KEYWORDS,
} from './department-operations.service';
import type { WorkspaceRecord } from '../workspace/workspace.service';
import type { WhatsAppEvent } from './whatsapp.parser';
import { setStaffDirectory, clearStaffDirectory } from './whatsapp.audience';

function createMockEvent(opts: {
  sender?: string;
  messageId?: string;
  text?: string;
  buttonId?: string;
  listId?: string;
}): WhatsAppEvent {
  const sender = opts.sender || '918919537879';
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

describe('DepartmentOperationsService', () => {
  let service: DepartmentOperationsService;
  let mockWorkspace: any;
  let sentBodies: any[];
  let mockFetch: any;

  const deptPhone = '918919537879';
  const mpPhone = '919988776655';
  const citizenPhone = '919123456789';

  const sampleGrievance: WorkspaceRecord = {
    id: 'gr_101',
    section: 'grievances',
    title: 'Drinking water pipeline leak',
    detail: 'Pipeline burst near RTC bus stand in Narasaraopet',
    status: 'In progress',
    date: '2026-10-29',
    createdBy: 'Ravi Kumar',
    followUpDepartment: 'Water supply',
    department: 'Water supply',
    place: 'Narasaraopet',
    leader: 'Ramesh',
    srNumber: 'JV-GR-2026-0101',
    fullName: 'Ravi Kumar',
    contactNumber: '919876543210',
    address: 'RTC Colony',
    email: 'ravi@example.com',
    progressToken: 'token_gr101abc',
    progressStages: [
      { name: 'Work started', status: 'Completed', note: 'Excavation begun' },
      { name: 'Inspection', status: 'Pending', note: '' },
      { name: 'Work in progress', status: 'Pending', note: '' },
      { name: 'Closing and handover', status: 'Pending', note: '' },
    ],
    progressRemarks: 'Excavation begun',
    progressUpdatedAt: '2026-10-29T10:00:00.000Z',
    progressHistory: [],
    assemblyConstituency: 'Narasaraopet',
    mandal: 'Narasaraopet',
    village: 'Ward 4',
    division: 'Narasaraopet',
    dateOfVisit: '2026-10-29',
    referenceName: '',
    referenceNumber: '',
    categories: ['Irrigation & Water Resources'],
    others: '',
    actionTaken: '',
    actionToBeTaken: 'Repair pipeline',
    assignedOfficer: 'AE Ramesh',
    resolutionStatus: 'In progress',
    deadline: '2026-11-05',
    visitDate: '',
    visitTime: '',
    leadPhone: '',
  };

  const sampleProject: WorkspaceRecord = {
    id: 'pr_201',
    section: 'projects',
    title: 'Narasaraopet Municipal Water Pipeline',
    detail: 'Pipeline replacement in Ward 12 to 14',
    status: 'In progress',
    date: '2026-10-20',
    createdBy: 'Department of Water',
    followUpDepartment: 'Water supply',
    department: 'Water supply',
    place: 'Narasaraopet',
    leader: 'Ramesh',
    srNumber: 'JV-PR-2026-0001',
    fullName: 'Municipal Water Project',
    contactNumber: '',
    address: 'Ward 12',
    email: '',
    progressToken: 'token_pr201xyz',
    progressStages: [
      { name: 'Work started', status: 'Completed', note: 'Sanction approved' },
      { name: 'Inspection', status: 'Completed', note: 'Survey done' },
      { name: 'Work in progress', status: 'In progress', note: 'Laying pipes' },
      { name: 'Closing and handover', status: 'Pending', note: '' },
    ],
    progressRemarks: 'Laying pipes in ward 12',
    progressUpdatedAt: '2026-10-28T14:00:00.000Z',
    progressHistory: [],
    assemblyConstituency: 'Narasaraopet',
    mandal: 'Narasaraopet',
    village: 'Narasaraopet',
    division: 'Narasaraopet',
    dateOfVisit: '',
    referenceName: '',
    referenceNumber: '',
    categories: ['Irrigation & Water Resources'],
    others: '',
    actionTaken: '',
    actionToBeTaken: '',
    assignedOfficer: 'EE Krishna',
    resolutionStatus: 'In progress',
    deadline: '2026-12-31',
    visitDate: '',
    visitTime: '',
    leadPhone: '',
  };

  const env: NodeJS.ProcessEnv = {
    WHATSAPP_ENABLED: 'true',
    WHATSAPP_ACCESS_TOKEN: 'test_token',
    WHATSAPP_PHONE_NUMBER_ID: 'test_phone_id',
    DEPARTMENT_WHATSAPP: deptPhone,
    DEPARTMENT_PHONES: '918919537879,919876543210',
    PUBLIC_APP_URL: 'https://janavignanam-three.vercel.app',
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
      list: jest.fn(async (section: string) => {
        if (section === 'grievances') return [sampleGrievance];
        if (section === 'projects') return [sampleProject];
        return [];
      }),
      get: jest.fn(async (id: string) => {
        if (id === sampleGrievance.id) return sampleGrievance;
        if (id === sampleProject.id) return sampleProject;
        return null;
      }),
      saveProgress: jest.fn(async (_tokenOrId: string, input: any) => {
        return {
          ...sampleGrievance,
          status: input.status || 'In progress',
          progressStages: input.stages,
          progressRemarks: input.remarks,
        };
      }),
    };

    setStaffDirectory([
      { phone: mpPhone, role: 'mp', name: 'MP Office' },
      { phone: deptPhone, role: 'admin', name: 'Department Officer' },
      { phone: citizenPhone, role: 'person', name: 'Citizen Person' },
      { phone: '919944332211', role: 'admin', name: 'Akshay' },
    ]);

    service = new DepartmentOperationsService(mockWorkspace, null as any);
  });

  afterEach(() => {
    clearStaffDirectory();
  });

  // =========================================================================
  // 1. Role Separation & Protection of MP System
  // =========================================================================
  describe('Role Separation & MP System Protection', () => {
    it('identifies department phones as department users', () => {
      expect(service.isDepartmentUser(deptPhone, env)).toBe(true);
      expect(service.isDepartmentUser('919876543210', env)).toBe(true);
    });

    it('NEVER identifies MP phones as department users', () => {
      expect(service.isDepartmentUser(mpPhone, env)).toBe(false);
    });

    it('denies department event routing to MP phones sending greetings or menu', () => {
      const mpMenuEvent = createMockEvent({ sender: mpPhone, text: 'menu' });
      expect(service.isDepartmentEvent(mpMenuEvent, mpPhone, env)).toBe(false);
    });

    it('allows department event routing to authorized department phones sending menu', () => {
      const deptMenuEvent = createMockEvent({
        sender: deptPhone,
        text: 'menu',
      });
      expect(service.isDepartmentEvent(deptMenuEvent, deptPhone, env)).toBe(
        true,
      );
    });

    it('rejects unauthorized phone numbers with an access restricted message', async () => {
      const unknownPhone = '911111111111';
      const event = createMockEvent({ sender: unknownPhone, text: 'dept' });
      await service.handleEvent(event, unknownPhone, mockFetch, env);

      expect(sentBodies.length).toBe(1);
      expect(sentBodies[0].text.body).toContain('Access Restricted');
    });
  });

  // =========================================================================
  // 2. Department Operations Main Menu
  // =========================================================================
  describe('Department Operations Main Menu', () => {
    it('renders the Department Operations Main Menu with Grievances and Projects & Reports', async () => {
      const event = createMockEvent({ sender: deptPhone, listId: 'dept:menu' });
      await service.handleEvent(event, deptPhone, mockFetch, env);

      expect(sentBodies.length).toBe(1);
      const interactive = sentBodies[0].interactive;
      expect(interactive.type).toBe('list');
      expect(interactive.body.text).toContain('DEPARTMENT OPERATIONS');

      const rows = interactive.action.sections[0].rows;
      expect(rows.map((r: any) => r.id)).toEqual([
        'dept:grievances',
        'dept:projects',
      ]);
      expect(rows[0].title).toBe('Grievances');
      expect(rows[1].title).toBe('Projects & Reports');
    });

    it('opens Grievances Submenu when Grievances is selected', async () => {
      const event = createMockEvent({
        sender: deptPhone,
        listId: 'dept:grievances',
      });
      await service.handleEvent(event, deptPhone, mockFetch, env);

      expect(sentBodies.length).toBe(1);
      const interactive = sentBodies[0].interactive;
      expect(interactive.type).toBe('list');
      expect(interactive.body.text).toContain('GRIEVANCE MANAGEMENT');

      const rowIds = interactive.action.sections[0].rows.map((r: any) => r.id);
      expect(rowIds).toEqual([
        'dept:g:assigned',
        'dept:g:update',
        'dept:g:view',
        'dept:g:recent',
        'dept:menu',
      ]);
    });

    it('opens Projects & Reports Submenu when Projects & Reports is selected', async () => {
      const event = createMockEvent({
        sender: deptPhone,
        listId: 'dept:projects',
      });
      await service.handleEvent(event, deptPhone, mockFetch, env);

      expect(sentBodies.length).toBe(1);
      const interactive = sentBodies[0].interactive;
      expect(interactive.type).toBe('list');
      expect(interactive.body.text).toContain('PROJECTS & REPORTS');

      const rowIds = interactive.action.sections[0].rows.map((r: any) => r.id);
      expect(rowIds).toEqual([
        'dept:p:assigned',
        'dept:p:update',
        'dept:p:details',
        'dept:p:reports',
        'dept:menu',
      ]);
    });
  });

  // =========================================================================
  // 3. Department Grievance Management Workflow
  // =========================================================================
  describe('Department Grievance Management', () => {
    it('lists assigned grievances with pagination and search options', async () => {
      const event = createMockEvent({
        sender: deptPhone,
        listId: 'dept:g:assigned',
      });
      await service.handleEvent(event, deptPhone, mockFetch, env);

      expect(mockWorkspace.list).toHaveBeenCalledWith('grievances');
      expect(sentBodies.length).toBe(1);
      const interactive = sentBodies[0].interactive;
      expect(interactive.type).toBe('list');
      expect(interactive.body.text).toContain('ASSIGNED GRIEVANCES');

      const rows = interactive.action.sections[0].rows;
      expect(rows[0].id).toContain('dept:g:pick:gr_101');
    });

    it('inspects 4-stage grievance details with visual progress bar and completion %', async () => {
      const event = createMockEvent({
        sender: deptPhone,
        listId: 'dept:g:pick:gr_101',
      });
      await service.handleEvent(event, deptPhone, mockFetch, env);

      expect(sentBodies.length).toBe(1);
      const body = sentBodies[0].interactive.body.text;
      expect(body).toContain('Grievance Progress Details');
      expect(body).toContain('JV-GR-2026-0101');
      expect(body).toContain('Water supply');
      expect(body).toContain('Work started: ✅ Completed');
      expect(body).toContain('Inspection: ⏳ Pending');
      expect(body).toContain('1 of 4 stages completed (25%)');
      expect(body).toContain('🟩⬜⬜⬜ 25%');
    });

    it('executes full grievance stage update with review confirmation and DB persistence', async () => {
      // 1. Pick stage
      const stageEvent = createMockEvent({
        sender: deptPhone,
        listId: 'dept:g:stg:gr_101:1',
      });
      await service.handleEvent(stageEvent, deptPhone, mockFetch, env);

      expect(sentBodies.length).toBe(1);
      expect(sentBodies[0].interactive.type).toBe('button');
      expect(sentBodies[0].interactive.body.text).toContain('SET STAGE STATUS');

      // 2. Pick status
      const statusEvent = createMockEvent({
        sender: deptPhone,
        buttonId: 'dept:g:sts:gr_101:1:Completed',
      });
      await service.handleEvent(statusEvent, deptPhone, mockFetch, env);

      expect(sentBodies.length).toBe(2);
      expect(sentBodies[1].type).toBe('text');
      expect(sentBodies[1].text.body).toContain('ENTER PROGRESS NOTE');

      // 3. Enter note
      const noteEvent = createMockEvent({
        sender: deptPhone,
        text: 'Joint inspection completed with AE Ramesh. Flow restored.',
      });
      await service.handleEvent(noteEvent, deptPhone, mockFetch, env);

      expect(sentBodies.length).toBe(3);
      const reviewText = sentBodies[2].interactive.body.text;
      expect(reviewText).toContain('REVIEW PROPOSED UPDATE');
      expect(reviewText).toContain('*Previous Status:* Pending');
      expect(reviewText).toContain('*Proposed Status:* *Completed*');
      expect(reviewText).toContain('Joint inspection completed');

      // 4. Confirm and Save
      const confirmEvent = createMockEvent({
        sender: deptPhone,
        buttonId: 'dept:g:conf:gr_101:1:Completed',
      });
      await service.handleEvent(confirmEvent, deptPhone, mockFetch, env);

      expect(mockWorkspace.saveProgress).toHaveBeenCalledTimes(1);
      expect(sentBodies.length).toBe(4);
      expect(sentBodies[3].interactive.body.text).toContain(
        'GRIEVANCE PROGRESS SAVED',
      );
    });

    it('shows recently updated grievances for the department', async () => {
      const event = createMockEvent({
        sender: deptPhone,
        listId: 'dept:g:recent',
      });
      await service.handleEvent(event, deptPhone, mockFetch, env);

      expect(sentBodies.length).toBe(1);
      expect(sentBodies[0].interactive.body.text).toContain(
        'RECENTLY UPDATED GRIEVANCES',
      );
      expect(sentBodies[0].interactive.body.text).toContain('JV-GR-2026-0101');
    });
  });

  // =========================================================================
  // 4. Department Project Management & Reports Workflow
  // =========================================================================
  describe('Department Project Management & Reports', () => {
    it('lists assigned projects with pagination and search options', async () => {
      const event = createMockEvent({
        sender: deptPhone,
        listId: 'dept:p:assigned',
      });
      await service.handleEvent(event, deptPhone, mockFetch, env);

      expect(mockWorkspace.list).toHaveBeenCalledWith('projects');
      expect(sentBodies.length).toBe(1);
      const interactive = sentBodies[0].interactive;
      expect(interactive.type).toBe('list');
      expect(interactive.body.text).toContain('ASSIGNED PROJECTS');

      const rows = interactive.action.sections[0].rows;
      expect(rows[0].id).toContain('dept:p:pick:pr_201');
    });

    it('inspects project details with milestones and progress bar', async () => {
      const event = createMockEvent({
        sender: deptPhone,
        listId: 'dept:p:pick:pr_201',
      });
      await service.handleEvent(event, deptPhone, mockFetch, env);

      expect(sentBodies.length).toBe(1);
      const body = sentBodies[0].interactive.body.text;
      expect(body).toContain('PROJECT DETAILS');
      expect(body).toContain('JV-PR-2026-0001');
      expect(body).toContain('Narasaraopet Municipal Water Pipeline');
      expect(body).toContain('*Milestone Progress:* 🟩🟩⬜⬜ 50%');
      expect(body).toContain('Work in progress: 🔄 *In progress*');
    });

    it('executes full project milestone update with review confirmation and persistence', async () => {
      // 1. Pick milestone 2 (Work in progress)
      const milestoneEvent = createMockEvent({
        sender: deptPhone,
        listId: 'dept:p:stg:pr_201:2',
      });
      await service.handleEvent(milestoneEvent, deptPhone, mockFetch, env);

      expect(sentBodies.length).toBe(1);
      expect(sentBodies[0].interactive.type).toBe('button');
      expect(sentBodies[0].interactive.body.text).toContain(
        'SET MILESTONE STATUS',
      );

      // 2. Pick status 'Completed'
      const statusEvent = createMockEvent({
        sender: deptPhone,
        buttonId: 'dept:p:sts:pr_201:2:Completed',
      });
      await service.handleEvent(statusEvent, deptPhone, mockFetch, env);

      expect(sentBodies.length).toBe(2);
      expect(sentBodies[1].type).toBe('text');
      expect(sentBodies[1].text.body).toContain('ENTER MILESTONE REMARKS');

      // 3. Enter remarks
      const remarksEvent = createMockEvent({
        sender: deptPhone,
        text: 'Pipeline laid and pressure tested with 0 leakage.',
      });
      await service.handleEvent(remarksEvent, deptPhone, mockFetch, env);

      expect(sentBodies.length).toBe(3);
      const reviewText = sentBodies[2].interactive.body.text;
      expect(reviewText).toContain('REVIEW PROJECT UPDATE');
      expect(reviewText).toContain('Work in progress');
      expect(reviewText).toContain('*Previous Status:* In progress');
      expect(reviewText).toContain('*Proposed Status:* *Completed*');
      expect(reviewText).toContain('Pipeline laid and pressure tested');

      // 4. Confirm and Save
      const confirmEvent = createMockEvent({
        sender: deptPhone,
        buttonId: 'dept:p:conf:pr_201:2:Completed',
      });
      await service.handleEvent(confirmEvent, deptPhone, mockFetch, env);

      expect(mockWorkspace.saveProgress).toHaveBeenCalledTimes(1);
      expect(sentBodies.length).toBe(4);
      expect(sentBodies[3].interactive.body.text).toContain(
        'PROJECT PROGRESS SAVED',
      );
    });

    it('generates a concise project summary report directly inside WhatsApp', async () => {
      const event = createMockEvent({
        sender: deptPhone,
        listId: 'dept:p:reports',
      });
      await service.handleEvent(event, deptPhone, mockFetch, env);

      expect(sentBodies.length).toBe(1);
      const body = sentBodies[0].interactive.body.text;
      expect(body).toContain('DEPARTMENT PROJECT REPORT');
      expect(body).toContain('Total Works: *1*');
      expect(body).toContain('Narasaraopet Municipal Water Pipeline');
      expect(body).toContain('Milestones: 🟩🟩⬜⬜ 50%');
    });
  });

  // =========================================================================
  // 5. Cancellation & Idempotency
  // =========================================================================
  describe('Cancellation & Idempotency', () => {
    it('cancels active operation when user sends cancel', async () => {
      const stageEvent = createMockEvent({
        sender: deptPhone,
        listId: 'dept:p:stg:pr_201:2',
      });
      await service.handleEvent(stageEvent, deptPhone, mockFetch, env);

      const cancelEvent = createMockEvent({
        sender: deptPhone,
        text: 'cancel',
      });
      await service.handleEvent(cancelEvent, deptPhone, mockFetch, env);

      expect(sentBodies.length).toBe(2);
      expect(sentBodies[1].interactive.body.text).toContain(
        'Progress update cancelled',
      );
    });

    it('prevents duplicate project update on identical webhook redelivery', async () => {
      const confirmEvent = createMockEvent({
        sender: deptPhone,
        buttonId: 'dept:p:conf:pr_201:2:Completed',
      });

      // First delivery
      await service.handleEvent(confirmEvent, deptPhone, mockFetch, env);
      expect(mockWorkspace.saveProgress).toHaveBeenCalledTimes(1);

      // Immediate second delivery (Meta webhook retry)
      await service.handleEvent(confirmEvent, deptPhone, mockFetch, env);
      expect(mockWorkspace.saveProgress).toHaveBeenCalledTimes(1); // Still 1 call
    });
  });
});
