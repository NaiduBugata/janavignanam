import { Injectable, Logger, Optional } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import {
  WorkspaceService,
  type WorkspaceRecord,
  type SaveProgressInput,
} from '../workspace/workspace.service';
import {
  STAGE_NAMES,
  type StageStatus,
  type ProgressStage,
  defaultStages,
  stageCounts,
} from '../workspace/progress-report';
import {
  sendReplyList,
  sendReplyButtons,
  sendTextMessage,
  type MenuRow,
  type ReplyButton,
} from './whatsapp.send';
import {
  isSuperAdminPhone,
  alertRecipients,
  replyRecipients,
  phoneForName,
} from './whatsapp.audience';
import { DEPARTMENT_WHATSAPP } from '../chatbot/grievance-priority';
import type { WhatsAppEvent } from './whatsapp.parser';

export const GPM_TRIGGER_KEYWORDS = [
  '#progress',
  'progress',
  'progress manager',
  'grievance progress',
  'grievance progress manager',
  'manage progress',
  'update progress',
  'gpm',
  '#gpm',
];

export const VALID_STAGE_STATUSES: StageStatus[] = [
  'Pending',
  'In progress',
  'Completed',
];

const SESSION_TTL_MS = 15 * 60 * 1000; // 15 minutes
const PAGE_SIZE = 8; // Fits in Meta 10-row list with pagination + back

export interface GpmSession {
  phone: string;
  step:
    | 'IDLE'
    | 'SELECT_GRIEVANCE'
    | 'REVIEW_PROGRESS'
    | 'SELECT_STAGE'
    | 'SELECT_STATUS'
    | 'ENTER_NOTE'
    | 'CONFIRM_UPDATE';
  action: 'update' | 'view';
  page: number;
  grievanceId?: string;
  grievanceTitle?: string;
  grievanceRecord?: WorkspaceRecord;
  selectedStageIndex?: number;
  selectedStageName?: string;
  selectedStatus?: StageStatus;
  enteredNote?: string;
  updatedAt: number;
}

export interface AdminAuthResult {
  authorized: boolean;
  role: 'superadmin' | 'admin' | 'officer';
  name: string;
  department?: string;
}

function digits(val: string): string {
  return String(val || '').replace(/\D/g, '');
}

function clip(str: string, maxLen: number): string {
  if (!str) return '';
  const trimmed = str.trim();
  return trimmed.length > maxLen ? trimmed.slice(0, maxLen - 1).trim() + '…' : trimmed;
}

function progressBar(completed: number, total: number): string {
  if (total <= 0) return '⬜⬜⬜⬜ 0%';
  const filled = Math.min(total, Math.max(0, completed));
  const empty = total - filled;
  const pct = Math.round((filled / total) * 100);
  return `${'🟩'.repeat(filled)}${'⬜'.repeat(empty)} ${pct}%`;
}

function progressPageUrl(env: NodeJS.ProcessEnv, token: string): string {
  const base = (env.PUBLIC_APP_URL || 'https://janavignanam-three.vercel.app')
    .trim()
    .replace(/\/$/, '');
  return `${base}/progress/${token}`;
}

@Injectable()
export class GrievanceProgressService {
  private readonly logger = new Logger(GrievanceProgressService.name);
  private readonly sessions = new Map<string, GpmSession>();

  constructor(
    @Optional() private readonly workspace?: WorkspaceService,
    @Optional() private readonly db?: DatabaseService,
  ) {}

  /**
   * Determine if an incoming WhatsApp event is directed to the Grievance Progress Manager.
   */
  isGpmEvent(event: WhatsAppEvent, sender: string): boolean {
    const rawId = this.replyId(event);
    if (rawId.startsWith('gpm:')) return true;

    // Active session for multi-step conversation
    const session = this.getSession(sender);
    if (session && session.step !== 'IDLE') return true;

    // Trigger keyword
    const textMsg = (event.message_text || '').trim().toLowerCase();
    return GPM_TRIGGER_KEYWORDS.includes(textMsg);
  }

  /**
   * Authorize whether the sender is allowed to manage grievance progress.
   */
  checkAuthorization(sender: string, env: NodeJS.ProcessEnv = process.env): AdminAuthResult {
    const d = digits(sender);
    if (!d) return { authorized: false, role: 'officer', name: 'Unknown' };

    // 1. Superadmin check
    if (isSuperAdminPhone(d)) {
      return { authorized: true, role: 'superadmin', name: 'Super Admin' };
    }

    // 2. Configured staff or alert recipients
    const alerts = alertRecipients().map(digits);
    const replies = replyRecipients().map(digits);
    const envRecipients = (env.WHATSAPP_RECIPIENTS || '')
      .split(',')
      .map(digits)
      .filter(Boolean);

    if (alerts.includes(d) || replies.includes(d) || envRecipients.includes(d)) {
      return { authorized: true, role: 'admin', name: 'Administrator' };
    }

    // 3. Akshay (Department Coordinator)
    const akshayPhone = digits(phoneForName('akshay') || '');
    if (akshayPhone && akshayPhone === d) {
      return { authorized: true, role: 'admin', name: 'Akshay (Department Head)' };
    }

    // 4. Default Department WhatsApp
    const deptWa = digits(DEPARTMENT_WHATSAPP);
    if (deptWa && deptWa === d) {
      return { authorized: true, role: 'officer', name: 'Department Officer' };
    }

    return { authorized: false, role: 'officer', name: 'Unauthorized' };
  }

  /**
   * Main dispatch entry point for Grievance Progress Manager.
   */
  async handleEvent(
    event: WhatsAppEvent,
    sender: string,
    fetchImpl: typeof fetch = fetch,
    env: NodeJS.ProcessEnv = process.env,
    deps: { records?: unknown } = {},
  ): Promise<void> {
    const auth = this.checkAuthorization(sender, env);
    if (!auth.authorized) {
      this.logger.warn(`Unauthorized GPM access attempt from ${sender}`);
      await sendTextMessage(
        sender,
        '🔒 *Access Restricted*\n\nThe *Grievance Progress Manager* is restricted to authorized department officers and administrators.\n\nYour WhatsApp number is not verified for in-chat progress updates.',
        fetchImpl,
        env,
      );
      return;
    }

    const reply = this.replyId(event);
    const textMsg = (event.message_text || '').trim();
    const session = this.getOrCreateSession(sender);

    // Global cancellation
    if (reply === 'gpm:cancel' || textMsg.toLowerCase() === 'cancel' || textMsg.toLowerCase() === 'exit') {
      this.clearSession(sender);
      await this.sendMenu(
        sender,
        'Progress update cancelled. You are back at the Grievance Progress Manager menu.',
        fetchImpl,
        env,
        auth,
      );
      return;
    }

    // Route by action or session step
    if (reply === 'gpm:menu' || GPM_TRIGGER_KEYWORDS.includes(textMsg.toLowerCase())) {
      this.clearSession(sender);
      await this.sendMenu(sender, undefined, fetchImpl, env, auth);
      return;
    }

    if (reply === 'gpm:help') {
      await this.sendHelp(sender, fetchImpl, env);
      return;
    }

    if (reply === 'gpm:assigned') {
      session.action = 'view';
      session.page = 1;
      await this.sendGrievanceList(sender, session, fetchImpl, env, auth, deps);
      return;
    }

    if (reply === 'gpm:update') {
      session.action = 'update';
      session.page = 1;
      await this.sendGrievanceList(sender, session, fetchImpl, env, auth, deps);
      return;
    }

    if (reply === 'gpm:view') {
      session.action = 'view';
      session.page = 1;
      await this.sendGrievanceList(sender, session, fetchImpl, env, auth, deps);
      return;
    }

    if (reply.startsWith('gpm:page:')) {
      const parts = reply.split(':');
      const newPage = parseInt(parts[2], 10) || 1;
      const action = (parts[3] as 'update' | 'view') || session.action || 'update';
      session.action = action;
      session.page = newPage;
      await this.sendGrievanceList(sender, session, fetchImpl, env, auth, deps);
      return;
    }

    // Grievance selected: gpm:sel:<id>:<action>
    if (reply.startsWith('gpm:sel:')) {
      const [, , id, action] = reply.split(':');
      session.action = (action as 'update' | 'view') || 'update';
      session.grievanceId = id;
      await this.handleGrievanceSelected(sender, id, session, fetchImpl, env, deps);
      return;
    }

    // Stage list requested: gpm:stg_list:<id>
    if (reply.startsWith('gpm:stg_list:')) {
      const id = reply.slice('gpm:stg_list:'.length);
      session.action = 'update';
      session.grievanceId = id;
      await this.sendStageSelection(sender, id, fetchImpl, env, deps);
      return;
    }

    // Stage picked: gpm:stg:<id>:<stageIndex>
    if (reply.startsWith('gpm:stg:')) {
      const [, , id, stageIdxStr] = reply.split(':');
      const stageIdx = parseInt(stageIdxStr, 10);
      session.grievanceId = id;
      session.selectedStageIndex = stageIdx;
      session.selectedStageName = STAGE_NAMES[stageIdx] || 'Work started';
      session.step = 'SELECT_STATUS';
      await this.sendStageStatusButtons(sender, session, fetchImpl, env, deps);
      return;
    }

    // Status picked: gpm:status:<status>
    if (reply.startsWith('gpm:status:')) {
      const status = reply.slice('gpm:status:'.length) as StageStatus;
      if (!VALID_STAGE_STATUSES.includes(status)) {
        await sendTextMessage(sender, 'Invalid status selected. Please choose Pending, In progress, or Completed.', fetchImpl, env);
        return;
      }
      session.selectedStatus = status;
      session.step = 'ENTER_NOTE';
      await this.promptForNote(sender, session, fetchImpl, env);
      return;
    }

    // Note entered via text message
    if (session.step === 'ENTER_NOTE') {
      const isSkip = textMsg.toLowerCase() === 'skip' || textMsg.toLowerCase() === 'none' || textMsg === '-';
      session.enteredNote = isSkip ? '' : textMsg.slice(0, 500);
      session.step = 'CONFIRM_UPDATE';
      await this.sendReviewConfirmation(sender, session, fetchImpl, env, deps);
      return;
    }

    // Confirmation received: gpm:confirm:yes or gpm:confirm:no
    if (reply === 'gpm:confirm:yes' || (session.step === 'CONFIRM_UPDATE' && textMsg.toLowerCase() === 'yes')) {
      await this.executeSaveProgress(sender, session, fetchImpl, env, auth, deps);
      return;
    }

    if (reply === 'gpm:confirm:no' || (session.step === 'CONFIRM_UPDATE' && textMsg.toLowerCase() === 'no')) {
      this.clearSession(sender);
      await this.sendMenu(sender, 'Update cancelled. No changes were made.', fetchImpl, env, auth);
      return;
    }

    // Fallback if input not recognized
    await sendTextMessage(
      sender,
      'I did not recognize that input. Reply *progress* to view the menu or *cancel* to abort.',
      fetchImpl,
      env,
    );
  }

  // =========================================================================
  // VIEW RENDERERS & WORKFLOW METHODS
  // =========================================================================

  /**
   * Render the Grievance Progress Manager Main Menu.
   */
  async sendMenu(
    sender: string,
    leadText?: string,
    fetchImpl: typeof fetch = fetch,
    env: NodeJS.ProcessEnv = process.env,
    auth?: AdminAuthResult,
  ): Promise<void> {
    const greeting = auth?.name ? `Welcome, *${auth.name}*. ` : '';
    const body = leadText ||
      `*Grievance Progress Manager*\nJanaVignanam Official Portal\n\n${greeting}Update and monitor grievance stages directly in WhatsApp. All changes synchronize immediately with the web portal.\n\nChoose an option below:`;

    const rows: MenuRow[] = [
      {
        id: 'gpm:update',
        title: 'Update Progress',
        description: 'Update stage status and progress notes',
      },
      {
        id: 'gpm:view',
        title: 'View Current Progress',
        description: 'Review stage details and completion %',
      },
      {
        id: 'gpm:assigned',
        title: 'Assigned Grievances',
        description: 'List active open grievances',
      },
      {
        id: 'gpm:help',
        title: 'Help & Instructions',
        description: 'How to use this manager',
      },
      {
        id: 'home',
        title: 'Main Menu',
        description: 'Return to MediaSphere menu',
      },
    ];

    await sendReplyList(sender, body, rows, {
      button: 'Select Option',
      header: 'Progress Manager',
      footer: 'Tap to manage grievance stages',
      fetchImpl,
      env,
    });
  }

  /**
   * Display paginated list of authorized grievances.
   */
  async sendGrievanceList(
    sender: string,
    session: GpmSession,
    fetchImpl: typeof fetch = fetch,
    env: NodeJS.ProcessEnv = process.env,
    auth?: AdminAuthResult,
    deps: { records?: unknown } = {},
  ): Promise<void> {
    const grievances = await this.loadAuthorizedGrievances(auth, deps);
    if (!grievances.length) {
      await sendReplyButtons(
        sender,
        '*Grievance Progress Manager*\n\nNo active grievances found assigned to your department.',
        [{ id: 'gpm:menu', title: 'Progress Menu' }],
        fetchImpl,
        env,
      );
      return;
    }

    const page = session.page || 1;
    const totalPages = Math.ceil(grievances.length / PAGE_SIZE) || 1;
    const startIdx = (page - 1) * PAGE_SIZE;
    const pageItems = grievances.slice(startIdx, startIdx + PAGE_SIZE);

    const action = session.action || 'update';
    const actionLabel = action === 'update' ? 'update' : 'view';

    const rows: MenuRow[] = pageItems.map((g) => {
      const sr = g.srNumber ? `#${g.srNumber.slice(-4)} ` : '';
      const title = `${sr}${g.title || 'Grievance'}`;
      const dept = g.followUpDepartment || g.department || 'General';
      const place = g.place || 'Constituency';
      const status = g.status || 'Pending';
      return {
        id: `gpm:sel:${g.id}:${action}`,
        title: clip(title, 24),
        description: clip(`${dept} · ${place} · ${status}`, 72),
      };
    });

    // Pagination rows
    if (page < totalPages) {
      rows.push({
        id: `gpm:page:${page + 1}:${action}`,
        title: `Next (${page + 1}/${totalPages})`,
        description: `View next ${Math.min(PAGE_SIZE, grievances.length - (page * PAGE_SIZE))} items`,
      });
    }
    if (page > 1) {
      rows.push({
        id: `gpm:page:${page - 1}:${action}`,
        title: `Prev (${page - 1}/${totalPages})`,
        description: `View previous items`,
      });
    }
    if (rows.length < 10) {
      rows.push({ id: 'gpm:menu', title: 'Progress Menu' });
    }

    const header = action === 'update' ? 'Select Grievance' : 'View Progress';
    const body = `*${header} (Page ${page}/${totalPages})*\n\nTap a grievance below to ${actionLabel} its stages:`;

    await sendReplyList(sender, body, rows, {
      button: 'Select Grievance',
      header: 'Grievances',
      footer: `Page ${page} of ${totalPages}`,
      fetchImpl,
      env,
    });
  }

  /**
   * Grievance selected: either show current progress or jump to stage selection.
   */
  async handleGrievanceSelected(
    sender: string,
    grievanceId: string,
    session: GpmSession,
    fetchImpl: typeof fetch = fetch,
    env: NodeJS.ProcessEnv = process.env,
    deps: { records?: unknown } = {},
  ): Promise<void> {
    const record = await this.getGrievance(grievanceId, deps);
    if (!record) {
      await sendTextMessage(sender, 'Grievance record not found or no longer available.', fetchImpl, env);
      await this.sendMenu(sender, undefined, fetchImpl, env);
      return;
    }

    session.grievanceRecord = record;
    session.grievanceTitle = record.title;

    if (session.action === 'view') {
      await this.sendCurrentProgressView(sender, record, fetchImpl, env);
    } else {
      await this.sendStageSelection(sender, grievanceId, fetchImpl, env, deps);
    }
  }

  /**
   * Display the full current progress details and completion percentage.
   */
  async sendCurrentProgressView(
    sender: string,
    record: WorkspaceRecord,
    fetchImpl: typeof fetch = fetch,
    env: NodeJS.ProcessEnv = process.env,
  ): Promise<void> {
    const stages = record.progressStages && record.progressStages.length
      ? record.progressStages
      : defaultStages();
    const counts = stageCounts(stages);
    const pct = Math.round((counts.completed / stages.length) * 100);
    const bar = progressBar(counts.completed, stages.length);
    const token = record.progressToken || '';
    const webUrl = token ? progressPageUrl(env, token) : 'Link available upon approval';

    const stageLines = stages
      .map((s, idx) => {
        const icon = s.status === 'Completed' ? '✅' : s.status === 'In progress' ? '⏳' : '⬜';
        const note = s.note ? `\n   ↳ _${s.note}_` : '';
        return `${idx + 1}. ${icon} ${s.name}: ${s.status}${note}`;
      })
      .join('\n');

    const message = [
      `📋 *Grievance Progress Details*`,
      ``,
      `*ID:* #${record.id.slice(-6)} · *Status:* ${record.status || 'Open'}`,
      `*Title:* ${clip(record.title, 80)}`,
      `*Department:* ${record.followUpDepartment || record.department || 'General'}`,
      `*Location:* ${record.place || 'Constituency'}`,
      `*Complainant:* ${record.fullName || record.createdBy || 'Citizen'}`,
      ``,
      `📊 *Overall Progress:* ${counts.completed} of ${stages.length} stages completed (${pct}%)`,
      bar,
      ``,
      stageLines,
      ``,
      `🌐 *Web Portal Link:*`,
      webUrl,
    ].join('\n');

    const buttons: ReplyButton[] = [
      { id: `gpm:stg_list:${record.id}`, title: 'Update Stage' },
      { id: 'gpm:update', title: 'Other Grievance' },
      { id: 'gpm:menu', title: 'Progress Menu' },
    ];

    await sendReplyButtons(sender, message, buttons, fetchImpl, env);
  }

  /**
   * Step 3: Present list of the 4 progress stages to update.
   */
  async sendStageSelection(
    sender: string,
    grievanceId: string,
    fetchImpl: typeof fetch = fetch,
    env: NodeJS.ProcessEnv = process.env,
    deps: { records?: unknown } = {},
  ): Promise<void> {
    const record = await this.getGrievance(grievanceId, deps);
    if (!record) {
      await sendTextMessage(sender, 'Record not found.', fetchImpl, env);
      return;
    }

    const stages = record.progressStages && record.progressStages.length
      ? record.progressStages
      : defaultStages();
    const counts = stageCounts(stages);
    const pct = Math.round((counts.completed / stages.length) * 100);

    const rows: MenuRow[] = stages.map((s, idx) => ({
      id: `gpm:stg:${grievanceId}:${idx}`,
      title: clip(`${idx + 1}. ${s.name}`, 24),
      description: clip(`Current: ${s.status}${s.note ? ' · ' + s.note : ''}`, 72),
    }));

    rows.push({ id: 'gpm:cancel', title: 'Cancel Update' });

    const body = `*Update Progress Stage*\n\n📋 *Grievance:* ${clip(record.title, 50)}\n📊 *Current Progress:* ${counts.completed}/4 (${pct}%)\n\nSelect which stage to update:`;

    await sendReplyList(sender, body, rows, {
      button: 'Select Stage',
      header: 'Stage Selector',
      footer: 'Tap stage to update status',
      fetchImpl,
      env,
    });
  }

  /**
   * Step 4: Present interactive buttons for the 3 valid statuses.
   */
  async sendStageStatusButtons(
    sender: string,
    session: GpmSession,
    fetchImpl: typeof fetch = fetch,
    env: NodeJS.ProcessEnv = process.env,
    deps: { records?: unknown } = {},
  ): Promise<void> {
    const record = session.grievanceRecord || (await this.getGrievance(session.grievanceId || '', deps));
    const stageIdx = session.selectedStageIndex ?? 0;
    const stages = record?.progressStages && record.progressStages.length ? record.progressStages : defaultStages();
    const current = stages[stageIdx];

    const message = [
      `*Stage Status Selector*`,
      ``,
      `📋 *Grievance:* ${clip(record?.title || 'Grievance', 50)}`,
      `🔧 *Selected Stage:* ${current?.name || session.selectedStageName}`,
      `📌 *Current Status:* ${current?.status || 'Pending'}`,
      current?.note ? `📝 *Current Note:* ${current.note}` : '',
      ``,
      `Choose the new status:`,
    ].filter(Boolean).join('\n');

    const buttons: ReplyButton[] = [
      { id: 'gpm:status:Pending', title: 'Pending' },
      { id: 'gpm:status:In progress', title: 'In Progress' },
      { id: 'gpm:status:Completed', title: 'Completed' },
    ];

    await sendReplyButtons(sender, message, buttons, fetchImpl, env);
  }

  /**
   * Step 5: Prompt user for progress remarks / stage note.
   */
  async promptForNote(
    sender: string,
    session: GpmSession,
    fetchImpl: typeof fetch = fetch,
    env: NodeJS.ProcessEnv = process.env,
  ): Promise<void> {
    const message = [
      `*Enter Progress Note*`,
      ``,
      `🔧 *Stage:* ${session.selectedStageName} ➔ *${session.selectedStatus}*`,
      ``,
      `Please reply with a brief note describing the action taken or inspection update.`,
      ``,
      `• Reply with your note text`,
      `• Or reply *skip* to leave note empty/unchanged`,
      `• Or reply *cancel* to abort`,
    ].join('\n');

    await sendTextMessage(sender, message, fetchImpl, env);
  }

  /**
   * Step 6 & 7: Present summary of proposed update with Confirm & Save buttons.
   */
  async sendReviewConfirmation(
    sender: string,
    session: GpmSession,
    fetchImpl: typeof fetch = fetch,
    env: NodeJS.ProcessEnv = process.env,
    deps: { records?: unknown } = {},
  ): Promise<void> {
    const record = session.grievanceRecord || (await this.getGrievance(session.grievanceId || '', deps));

    const message = [
      `*Review Proposed Progress Update*`,
      ``,
      `📋 *Grievance:* #${(record?.id || '').slice(-6)} ${clip(record?.title || 'Grievance', 50)}`,
      `🏢 *Department:* ${record?.followUpDepartment || record?.department || 'General'}`,
      `📍 *Location:* ${record?.place || 'Constituency'}`,
      ``,
      `🔧 *Stage:* ${session.selectedStageName}`,
      `📊 *New Status:* *${session.selectedStatus}*`,
      `📝 *Note:* ${session.enteredNote ? `"${session.enteredNote}"` : '_(none)_'}`,
      ``,
      `Please confirm to save this update directly into the website portal database:`,
    ].join('\n');

    const buttons: ReplyButton[] = [
      { id: 'gpm:confirm:yes', title: 'Confirm & Save' },
      { id: 'gpm:confirm:no', title: 'Cancel' },
    ];

    await sendReplyButtons(sender, message, buttons, fetchImpl, env);
  }

  /**
   * Step 8: Persist the update using authoritative WorkspaceService & display result.
   */
  async executeSaveProgress(
    sender: string,
    session: GpmSession,
    fetchImpl: typeof fetch = fetch,
    env: NodeJS.ProcessEnv = process.env,
    auth?: AdminAuthResult,
    deps: { records?: unknown } = {},
  ): Promise<void> {
    const grievanceId = session.grievanceId;
    if (!grievanceId) {
      await sendTextMessage(sender, 'No grievance selected. Session expired.', fetchImpl, env);
      this.clearSession(sender);
      return;
    }

    const record = await this.getGrievance(grievanceId, deps);
    if (!record) {
      await sendTextMessage(sender, 'Grievance record could not be found.', fetchImpl, env);
      this.clearSession(sender);
      return;
    }

    const stageIdx = session.selectedStageIndex ?? 0;
    const stages: ProgressStage[] = record.progressStages && record.progressStages.length
      ? JSON.parse(JSON.stringify(record.progressStages))
      : defaultStages();

    const stageName = session.selectedStageName || STAGE_NAMES[stageIdx] || 'Work started';
    const newStatus = session.selectedStatus || 'In progress';
    const note = session.enteredNote !== undefined ? session.enteredNote : (stages[stageIdx]?.note || '');

    // Update the specific stage
    stages[stageIdx] = {
      name: stageName,
      status: newStatus,
      note,
    };

    // Calculate new overall record status
    const allCompleted = stages.every((s) => s.status === 'Completed');
    const anyActive = stages.some((s) => s.status === 'In progress' || s.status === 'Completed');
    const newRecordStatus = allCompleted ? 'Completed' : (anyActive ? 'In progress' : 'Pending');

    const dept = record.followUpDepartment || record.department || auth?.department || 'Department';

    const input: SaveProgressInput = {
      stages,
      status: newRecordStatus,
      remarks: note || `Stage "${stageName}" updated to ${newStatus} via WhatsApp`,
      department: dept,
    };

    try {
      if (this.workspace && record.progressToken) {
        await this.workspace.saveProgress(record.progressToken, input);
      } else if (this.db) {
        // Fallback direct collection update if token missing
        const collection = this.db.collection('jv_records');
        await collection.updateOne(
          { _id: record.id },
          {
            $set: {
              progressStages: stages,
              status: newRecordStatus,
              progressRemarks: input.remarks,
              progressUpdatedAt: new Date().toISOString(),
            },
          },
        );
      }

      this.logger.log(`Grievance #${record.id} progress updated to ${newStatus} by ${sender}`);

      const counts = stageCounts(stages);
      const pct = Math.round((counts.completed / stages.length) * 100);
      const bar = progressBar(counts.completed, stages.length);

      const stageLines = stages
        .map((s) => {
          const icon = s.status === 'Completed' ? '✅' : s.status === 'In progress' ? '⏳' : '⬜';
          return `${icon} ${s.name}: *${s.status}*`;
        })
        .join('\n');

      const successMsg = [
        `✅ *Progress Saved Successfully!*`,
        ``,
        `📋 *Grievance:* ${clip(record.title, 50)}`,
        `📊 *Overall Progress:* ${counts.completed} of ${stages.length} stages completed (${pct}%)`,
        bar,
        ``,
        stageLines,
        ``,
        `🌐 *Database and website portal updated immediately.*`,
      ].join('\n');

      this.clearSession(sender);

      const buttons: ReplyButton[] = [
        { id: `gpm:stg_list:${record.id}`, title: 'Update Other Stage' },
        { id: 'gpm:update', title: 'Other Grievance' },
        { id: 'gpm:menu', title: 'Progress Menu' },
      ];

      await sendReplyButtons(sender, successMsg, buttons, fetchImpl, env);
    } catch (err) {
      this.logger.error(`Failed to save progress for grievance #${record.id}:`, err);
      await sendTextMessage(
        sender,
        `⚠️ *Save Failed*\n\nCould not update grievance progress due to an error: ${err instanceof Error ? err.message : 'Database error'}. Please try again.`,
        fetchImpl,
        env,
      );
      this.clearSession(sender);
    }
  }

  /**
   * Help message explaining the workflow.
   */
  async sendHelp(
    sender: string,
    fetchImpl: typeof fetch = fetch,
    env: NodeJS.ProcessEnv = process.env,
  ): Promise<void> {
    const helpText = [
      `ℹ️ *Grievance Progress Manager - Help*`,
      ``,
      `This tool enables authorized administrators and department officers to update grievance progress directly within WhatsApp without needing to sign into the web portal.`,
      ``,
      `*How to use:*`,
      `1️⃣ Tap *Update Progress* to list active grievances.`,
      `2️⃣ Tap a grievance to review its details.`,
      `3️⃣ Select a stage: _Work started, Inspection, Work in progress, or Closing and handover_.`,
      `4️⃣ Select status: _Pending, In Progress, or Completed_.`,
      `5️⃣ Reply with a short note explaining the action taken (or reply _skip_).`,
      `6️⃣ Tap *Confirm & Save* to persist the changes.`,
      ``,
      `*Commands:*`,
      `• Reply *cancel* anytime to abort an update.`,
      `• Reply *progress* or *#progress* to return to the menu.`,
      `• Updates are instantly synced with the official website database.`,
    ].join('\n');

    const buttons: ReplyButton[] = [
      { id: 'gpm:update', title: 'Update Progress' },
      { id: 'gpm:menu', title: 'Progress Menu' },
      { id: 'home', title: 'Main Menu' },
    ];

    await sendReplyButtons(sender, helpText, buttons, fetchImpl, env);
  }

  // =========================================================================
  // DATA ACCESS & SESSION HELPERS
  // =========================================================================

  private async loadAuthorizedGrievances(
    auth?: AdminAuthResult,
    deps: { records?: unknown } = {},
  ): Promise<WorkspaceRecord[]> {
    let items: WorkspaceRecord[] = [];
    if (this.workspace) {
      try {
        items = await this.workspace.list('grievances');
      } catch (err) {
        this.logger.warn('Failed to load grievances from workspace service', err);
      }
    }

    if (!items.length && deps.records && Array.isArray(deps.records)) {
      items = deps.records as WorkspaceRecord[];
    }

    // Filter by department if officer has department restrictions
    if (auth?.role === 'officer' && auth.department) {
      const deptNeedle = auth.department.toLowerCase();
      items = items.filter((g) => {
        const d = (g.followUpDepartment || g.department || '').toLowerCase();
        return d.includes(deptNeedle);
      });
    }

    // Only active/open grievances by default (Open, Reviewed, Pending, In progress, Approved)
    return items.filter((g) => g.status !== 'Closed' && g.status !== 'Rejected');
  }

  private async getGrievance(
    id: string,
    deps: { records?: unknown } = {},
  ): Promise<WorkspaceRecord | null> {
    if (this.workspace) {
      try {
        return await this.workspace.get(id);
      } catch {
        // Fall back to list search
      }
    }
    if (deps.records && Array.isArray(deps.records)) {
      return (deps.records as WorkspaceRecord[]).find((r) => r.id === id) || null;
    }
    return null;
  }

  private getSession(sender: string): GpmSession | null {
    const s = this.sessions.get(digits(sender));
    if (!s) return null;
    if (Date.now() - s.updatedAt > SESSION_TTL_MS) {
      this.sessions.delete(digits(sender));
      return null;
    }
    return s;
  }

  private getOrCreateSession(sender: string): GpmSession {
    let s = this.getSession(sender);
    if (!s) {
      s = {
        phone: digits(sender),
        step: 'IDLE',
        action: 'update',
        page: 1,
        updatedAt: Date.now(),
      };
      this.sessions.set(digits(sender), s);
    }
    s.updatedAt = Date.now();
    return s;
  }

  private clearSession(sender: string): void {
    this.sessions.delete(digits(sender));
  }

  private replyId(event: WhatsAppEvent): string {
    const reply =
      event.interactive_response?.list_reply ||
      event.interactive_response?.button_reply;
    if (!reply || typeof reply !== 'object') return '';
    return String((reply as Record<string, unknown>).id || '').trim();
  }
}
