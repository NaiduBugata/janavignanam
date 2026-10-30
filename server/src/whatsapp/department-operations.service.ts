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
  isMpPhone,
  alertRecipients,
  replyRecipients,
  phoneForName,
} from './whatsapp.audience';
import {
  DEPARTMENT_WHATSAPP,
  assignDesk,
  DESKS,
  GENERAL_DESK,
} from '../chatbot/grievance-priority';
import type { WhatsAppEvent } from './whatsapp.parser';

// ============================================================================
// CONSTANTS & TYPES
// ============================================================================

export const DEPT_TRIGGER_KEYWORDS = [
  '#progress',
  'progress',
  'progress manager',
  'grievance progress',
  'grievance progress manager',
  'manage progress',
  'update progress',
  'gpm',
  '#gpm',
  'dept',
  'department',
  '#dept',
  'operations',
  'department operations',
  'projects',
  'reports',
];

export const VALID_STAGE_STATUSES: StageStatus[] = [
  'Pending',
  'In progress',
  'Completed',
];

const SESSION_TTL_MS = 15 * 60 * 1000; // 15 minutes
const IDEMPOTENCY_TTL_MS = 60 * 1000; // 60 seconds
const PAGE_SIZE = 7;

export interface DeptSession {
  phone: string;
  step:
    | 'IDLE'
    | 'DEPT_MAIN_MENU'
    | 'GRIEVANCES_MENU'
    | 'PROJECTS_MENU'
    | 'SELECT_GRIEVANCE'
    | 'SEARCH_GRIEVANCE'
    | 'REVIEW_PROGRESS'
    | 'SELECT_GRIEVANCE_STAGE'
    | 'SELECT_GRIEVANCE_STATUS'
    | 'ENTER_GRIEVANCE_NOTE'
    | 'CONFIRM_GRIEVANCE'
    | 'SELECT_PROJECT'
    | 'SEARCH_PROJECT'
    | 'SELECT_PROJECT_MILESTONE'
    | 'SELECT_PROJECT_STATUS'
    | 'ENTER_PROJECT_REMARKS'
    | 'CONFIRM_PROJECT';
  module: 'grievances' | 'projects';
  action: 'view' | 'update' | 'recent' | 'reports';
  page: number;
  searchQuery?: string;
  recordId?: string;
  recordTitle?: string;
  record?: WorkspaceRecord;
  selectedStageIndex?: number;
  selectedStageName?: string;
  previousStatus?: StageStatus;
  selectedStatus?: StageStatus;
  enteredNote?: string;
  updatedAt: number;
}

export interface DeptAuthResult {
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
  return trimmed.length > maxLen
    ? trimmed.slice(0, maxLen - 1).trim() + '…'
    : trimmed;
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

// ============================================================================
// SERVICE IMPLEMENTATION
// ============================================================================

@Injectable()
export class DepartmentOperationsService {
  private readonly logger = new Logger(DepartmentOperationsService.name);
  private readonly sessions = new Map<string, DeptSession>();
  private readonly idempotencyCache = new Map<
    string,
    { timestamp: number; summary: string }
  >();

  constructor(
    @Optional() private readonly workspace?: WorkspaceService,
    @Optional() private readonly db?: DatabaseService,
  ) {}

  /**
   * Fast check: Is the sender recognized as a department user?
   * CRITICAL RULE: MP office phones must NEVER be treated as department users.
   */
  isDepartmentUser(
    sender: string,
    env: NodeJS.ProcessEnv = process.env,
  ): boolean {
    const d = digits(sender);
    if (!d) return false;
    if (isMpPhone(d)) return false;

    // 1. Primary department WhatsApp number
    const deptWa = digits(env.DEPARTMENT_WHATSAPP || DEPARTMENT_WHATSAPP);
    if (deptWa && deptWa === d) return true;

    // 2. Configured department phone numbers list
    const envDeptPhones = (env.DEPARTMENT_PHONES || '')
      .split(',')
      .map(digits)
      .filter(Boolean);
    if (envDeptPhones.includes(d)) return true;

    // 3. Akshay (Department Coordinator / Head)
    const akshayPhone = digits(phoneForName('akshay') || '');
    if (akshayPhone && akshayPhone === d) return true;

    // 4. Desk leaders
    if (Array.isArray(DESKS)) {
      for (const desk of DESKS) {
        const leaderPhone = digits(phoneForName(desk.leader) || '');
        if (leaderPhone && leaderPhone === d) return true;
      }
    }
    if (GENERAL_DESK) {
      const generalLeader = digits(phoneForName(GENERAL_DESK.leader) || '');
      if (generalLeader && generalLeader === d) return true;
    }

    return false;
  }

  /**
   * Determine if an incoming WhatsApp event should be handled by Department Operations.
   */
  isDepartmentEvent(
    event: WhatsAppEvent,
    sender: string,
    env: NodeJS.ProcessEnv = process.env,
  ): boolean {
    const rawId = this.replyId(event);
    if (rawId.startsWith('dept:') || rawId.startsWith('gpm:')) return true;

    // If user has an active in-flight session
    const session = this.getSession(sender);
    if (session && session.step !== 'IDLE') return true;

    // Keyword match
    const textMsg = (event.message_text || '').trim().toLowerCase();
    if (DEPT_TRIGGER_KEYWORDS.includes(textMsg)) return true;

    // If the sender is an authorized department user (and NOT an MP user),
    // intercept greetings, menu requests, and initial messages so they get the Department Menu
    if (this.isDepartmentUser(sender, env)) {
      if (
        !textMsg ||
        textMsg === 'menu' ||
        textMsg === 'home' ||
        textMsg === 'hi' ||
        textMsg === 'hello' ||
        textMsg === 'start' ||
        textMsg === 'help' ||
        textMsg === 'operations' ||
        textMsg === 'department'
      ) {
        return true;
      }
    }

    return false;
  }

  /**
   * Backwards-compatible alias for GPM event check.
   */
  isGpmEvent(
    event: WhatsAppEvent,
    sender: string,
    env: NodeJS.ProcessEnv = process.env,
  ): boolean {
    return this.isDepartmentEvent(event, sender, env);
  }

  /**
   * Authorize department user and identify their department scope.
   */
  checkAuthorization(
    sender: string,
    env: NodeJS.ProcessEnv = process.env,
  ): DeptAuthResult {
    const d = digits(sender);
    if (!d) return { authorized: false, role: 'officer', name: 'Unknown' };

    // 1. Superadmin check (has full access across all departments)
    if (isSuperAdminPhone(d)) {
      return { authorized: true, role: 'superadmin', name: 'Super Admin' };
    }

    // 2. Staff admin recipients
    const alerts = alertRecipients().map(digits);
    const replies = replyRecipients().map(digits);
    const envRecipients = (env.WHATSAPP_RECIPIENTS || '')
      .split(',')
      .map(digits)
      .filter(Boolean);

    if (
      alerts.includes(d) ||
      replies.includes(d) ||
      envRecipients.includes(d)
    ) {
      return { authorized: true, role: 'admin', name: 'Administrator' };
    }

    // 3. Akshay (Department Coordinator / Head)
    const akshayPhone = digits(phoneForName('akshay') || '');
    if (akshayPhone && akshayPhone === d) {
      return {
        authorized: true,
        role: 'admin',
        name: 'Akshay (Department Head)',
      };
    }

    // 4. Default Department WhatsApp
    const deptWa = digits(env.DEPARTMENT_WHATSAPP || DEPARTMENT_WHATSAPP);
    if (deptWa && deptWa === d) {
      return { authorized: true, role: 'officer', name: 'Department Officer' };
    }

    // 5. Configured Department Phones
    const envDeptPhones = (env.DEPARTMENT_PHONES || '')
      .split(',')
      .map(digits)
      .filter(Boolean);
    if (envDeptPhones.includes(d)) {
      return { authorized: true, role: 'officer', name: 'Department Officer' };
    }

    // 6. Specific Desk Leaders
    if (Array.isArray(DESKS)) {
      for (const desk of DESKS) {
        const leaderPhone = digits(phoneForName(desk.leader) || '');
        if (leaderPhone && leaderPhone === d) {
          return {
            authorized: true,
            role: 'officer',
            name: desk.leader,
            department: desk.name,
          };
        }
      }
    }
    if (GENERAL_DESK) {
      const generalLeader = digits(phoneForName(GENERAL_DESK.leader) || '');
      if (generalLeader && generalLeader === d) {
        return {
          authorized: true,
          role: 'officer',
          name: GENERAL_DESK.leader,
          department: GENERAL_DESK.name,
        };
      }
    }

    return { authorized: false, role: 'officer', name: 'Unauthorized' };
  }

  // =========================================================================
  // MAIN DISPATCH & ROUTING
  // =========================================================================

  async handleEvent(
    event: WhatsAppEvent,
    sender: string,
    fetchImpl: typeof fetch = fetch,
    env: NodeJS.ProcessEnv = process.env,
    deps: { records?: unknown } = {},
  ): Promise<void> {
    const auth = this.checkAuthorization(sender, env);
    if (!auth.authorized) {
      this.logger.warn(
        `Unauthorized department operations access attempt from ${sender}`,
      );
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
    if (
      reply === 'dept:cancel' ||
      reply === 'gpm:cancel' ||
      textMsg.toLowerCase() === 'cancel' ||
      textMsg.toLowerCase() === 'exit'
    ) {
      this.clearSession(sender);
      if (reply === 'gpm:cancel') {
        await this.sendGpmMenu(
          sender,
          'Progress update cancelled. You are back at the Grievance Progress Manager menu.',
          fetchImpl,
          env,
          auth,
        );
      } else {
        await this.sendDepartmentMainMenu(
          sender,
          fetchImpl,
          env,
          auth,
          'Progress update cancelled. You are back at the Department Operations menu.',
        );
      }
      return;
    }

    // Help & Instructions (Backward compatible)
    if (reply === 'gpm:help') {
      await this.sendGpmHelp(sender, fetchImpl, env);
      return;
    }

    // GPM Legacy Menu Trigger
    if (reply === 'gpm:menu') {
      this.clearSession(sender);
      await this.sendGpmMenu(sender, undefined, fetchImpl, env, auth);
      return;
    }

    // Department Operations Main Menu Trigger
    if (
      reply === 'dept:menu' ||
      reply === 'dept:main' ||
      textMsg.toLowerCase() === 'dept' ||
      textMsg.toLowerCase() === 'operations' ||
      textMsg.toLowerCase() === 'department'
    ) {
      this.clearSession(sender);
      await this.sendDepartmentMainMenu(sender, fetchImpl, env, auth);
      return;
    }

    // Generic menu keyword
    if (textMsg.toLowerCase() === 'menu' || textMsg.toLowerCase() === 'home') {
      this.clearSession(sender);
      await this.sendDepartmentMainMenu(sender, fetchImpl, env, auth);
      return;
    }

    // Keyword trigger for GPM specifically
    if (
      ['#progress', 'progress', 'gpm', '#gpm'].includes(textMsg.toLowerCase())
    ) {
      this.clearSession(sender);
      await this.sendGpmMenu(sender, undefined, fetchImpl, env, auth);
      return;
    }

    // Module Selection: Grievances
    if (reply === 'dept:grievances') {
      session.module = 'grievances';
      session.step = 'GRIEVANCES_MENU';
      await this.sendGrievancesMenu(sender, fetchImpl, env, auth);
      return;
    }

    // Module Selection: Projects & Reports
    if (reply === 'dept:projects') {
      session.module = 'projects';
      session.step = 'PROJECTS_MENU';
      await this.sendProjectsMenu(sender, fetchImpl, env, auth);
      return;
    }

    // -----------------------------------------------------------------------
    // GRIEVANCE SUBMENU ACTIONS
    // -----------------------------------------------------------------------
    if (reply === 'dept:g:assigned' || reply === 'gpm:assigned') {
      session.module = 'grievances';
      session.action = 'view';
      session.step = 'SELECT_GRIEVANCE';
      session.searchQuery = undefined;
      session.page = 1;
      await this.sendGrievanceList(sender, session, fetchImpl, env, auth, deps);
      return;
    }

    if (reply === 'dept:g:update' || reply === 'gpm:update') {
      session.module = 'grievances';
      session.action = 'update';
      session.step = 'SELECT_GRIEVANCE';
      session.searchQuery = undefined;
      session.page = 1;
      await this.sendGrievanceList(sender, session, fetchImpl, env, auth, deps);
      return;
    }

    if (reply === 'dept:g:view' || reply === 'gpm:view') {
      session.module = 'grievances';
      session.action = 'view';
      session.step = 'SELECT_GRIEVANCE';
      session.searchQuery = undefined;
      session.page = 1;
      await this.sendGrievanceList(sender, session, fetchImpl, env, auth, deps);
      return;
    }

    if (reply === 'dept:g:recent') {
      session.module = 'grievances';
      await this.sendRecentlyUpdatedGrievances(
        sender,
        fetchImpl,
        env,
        auth,
        deps,
      );
      return;
    }

    if (reply === 'dept:g:search' || reply === 'gpm:search') {
      session.module = 'grievances';
      session.step = 'SEARCH_GRIEVANCE';
      await sendTextMessage(
        sender,
        '🔍 *Search Assigned Grievances*\n\nPlease reply with a grievance reference number (e.g. *JV-GR-2026-0101* or *0101*), location, or description keyword.\n\nReply *cancel* to return to the menu.',
        fetchImpl,
        env,
      );
      return;
    }

    // Grievance Pagination
    if (reply.startsWith('dept:g:page:') || reply.startsWith('gpm:page:')) {
      const pageStr = reply.startsWith('dept:g:page:')
        ? reply.slice('dept:g:page:'.length)
        : reply.slice('gpm:page:'.length);
      const targetPage = Number.parseInt(pageStr, 10);
      if (!Number.isNaN(targetPage) && targetPage >= 1) {
        session.page = targetPage;
        await this.sendGrievanceList(
          sender,
          session,
          fetchImpl,
          env,
          auth,
          deps,
        );
        return;
      }
    }

    // Grievance Selection
    if (reply.startsWith('dept:g:pick:') || reply.startsWith('gpm:pick:')) {
      const id = reply.startsWith('dept:g:pick:')
        ? reply.slice('dept:g:pick:'.length)
        : reply.slice('gpm:pick:'.length);
      await this.handleGrievanceSelection(
        sender,
        session,
        id,
        fetchImpl,
        env,
        auth,
        deps,
      );
      return;
    }

    if (
      reply.startsWith('dept:g:up_pick:') ||
      reply.startsWith('gpm:up_pick:')
    ) {
      const id = reply.startsWith('dept:g:up_pick:')
        ? reply.slice('dept:g:up_pick:'.length)
        : reply.slice('gpm:up_pick:'.length);
      session.action = 'update';
      await this.handleGrievanceSelection(
        sender,
        session,
        id,
        fetchImpl,
        env,
        auth,
        deps,
      );
      return;
    }

    // Grievance Stage Selection
    if (reply.startsWith('dept:g:stg:') || reply.startsWith('gpm:stage:')) {
      const payload = reply.startsWith('dept:g:stg:')
        ? reply.slice('dept:g:stg:'.length)
        : reply.slice('gpm:stage:'.length);
      const [id, idxStr] = payload.split(':');
      const stageIdx = Number.parseInt(idxStr, 10);
      await this.handleGrievanceStageChoice(
        sender,
        session,
        id,
        stageIdx,
        fetchImpl,
        env,
        auth,
        deps,
      );
      return;
    }

    // Grievance Status Selection
    if (reply.startsWith('dept:g:sts:') || reply.startsWith('gpm:status:')) {
      const payload = reply.startsWith('dept:g:sts:')
        ? reply.slice('dept:g:sts:'.length)
        : reply.slice('gpm:status:'.length);
      const [id, idxStr, statusVal] = payload.split(':');
      const stageIdx = Number.parseInt(idxStr, 10);
      await this.handleGrievanceStatusChoice(
        sender,
        session,
        id,
        stageIdx,
        statusVal,
        fetchImpl,
        env,
        auth,
        deps,
      );
      return;
    }

    // Grievance Review Confirmation
    if (reply.startsWith('dept:g:conf:') || reply.startsWith('gpm:conf:')) {
      const payload = reply.startsWith('dept:g:conf:')
        ? reply.slice('dept:g:conf:'.length)
        : reply.slice('gpm:conf:'.length);
      const [id, idxStr, statusVal] = payload.split(':');
      const stageIdx = Number.parseInt(idxStr, 10);
      await this.commitGrievanceUpdate(
        sender,
        session,
        id,
        stageIdx,
        statusVal,
        fetchImpl,
        env,
        auth,
      );
      return;
    }

    // -----------------------------------------------------------------------
    // PROJECT SUBMENU ACTIONS
    // -----------------------------------------------------------------------
    if (reply === 'dept:p:assigned') {
      session.module = 'projects';
      session.action = 'view';
      session.step = 'SELECT_PROJECT';
      session.searchQuery = undefined;
      session.page = 1;
      await this.sendProjectList(sender, session, fetchImpl, env, auth, deps);
      return;
    }

    if (reply === 'dept:p:update') {
      session.module = 'projects';
      session.action = 'update';
      session.step = 'SELECT_PROJECT';
      session.searchQuery = undefined;
      session.page = 1;
      await this.sendProjectList(sender, session, fetchImpl, env, auth, deps);
      return;
    }

    if (reply === 'dept:p:details') {
      session.module = 'projects';
      session.action = 'view';
      session.step = 'SELECT_PROJECT';
      session.searchQuery = undefined;
      session.page = 1;
      await this.sendProjectList(sender, session, fetchImpl, env, auth, deps);
      return;
    }

    if (reply === 'dept:p:reports') {
      session.module = 'projects';
      await this.sendProjectReports(sender, fetchImpl, env, auth, deps);
      return;
    }

    if (reply === 'dept:p:search') {
      session.module = 'projects';
      session.step = 'SEARCH_PROJECT';
      await sendTextMessage(
        sender,
        '🔍 *Search Assigned Projects*\n\nPlease reply with a project reference number, name, or location keyword.\n\nReply *cancel* to return to the menu.',
        fetchImpl,
        env,
      );
      return;
    }

    // Project Pagination
    if (reply.startsWith('dept:p:page:')) {
      const pageStr = reply.slice('dept:p:page:'.length);
      const targetPage = Number.parseInt(pageStr, 10);
      if (!Number.isNaN(targetPage) && targetPage >= 1) {
        session.page = targetPage;
        await this.sendProjectList(sender, session, fetchImpl, env, auth, deps);
        return;
      }
    }

    // Project Selection
    if (reply.startsWith('dept:p:pick:')) {
      const id = reply.slice('dept:p:pick:'.length);
      await this.handleProjectSelection(
        sender,
        session,
        id,
        fetchImpl,
        env,
        auth,
        deps,
      );
      return;
    }

    if (reply.startsWith('dept:p:up_pick:')) {
      const id = reply.slice('dept:p:up_pick:'.length);
      session.action = 'update';
      await this.handleProjectSelection(
        sender,
        session,
        id,
        fetchImpl,
        env,
        auth,
        deps,
      );
      return;
    }

    // Project Milestone Selection
    if (reply.startsWith('dept:p:stg:')) {
      const payload = reply.slice('dept:p:stg:'.length);
      const [id, idxStr] = payload.split(':');
      const stageIdx = Number.parseInt(idxStr, 10);
      await this.handleProjectMilestoneChoice(
        sender,
        session,
        id,
        stageIdx,
        fetchImpl,
        env,
        auth,
        deps,
      );
      return;
    }

    // Project Status Selection
    if (reply.startsWith('dept:p:sts:')) {
      const payload = reply.slice('dept:p:sts:'.length);
      const [id, idxStr, statusVal] = payload.split(':');
      const stageIdx = Number.parseInt(idxStr, 10);
      await this.handleProjectStatusChoice(
        sender,
        session,
        id,
        stageIdx,
        statusVal,
        fetchImpl,
        env,
        auth,
        deps,
      );
      return;
    }

    // Project Review Confirmation
    if (reply.startsWith('dept:p:conf:')) {
      const payload = reply.slice('dept:p:conf:'.length);
      const [id, idxStr, statusVal] = payload.split(':');
      const stageIdx = Number.parseInt(idxStr, 10);
      await this.commitProjectUpdate(
        sender,
        session,
        id,
        stageIdx,
        statusVal,
        fetchImpl,
        env,
        auth,
      );
      return;
    }

    // -----------------------------------------------------------------------
    // TEXT-INPUT HANDLING (Search & Progress Notes)
    // -----------------------------------------------------------------------
    if (textMsg) {
      // 1. Grievance Search query
      if (session.step === 'SEARCH_GRIEVANCE') {
        session.searchQuery = textMsg;
        session.page = 1;
        await this.sendGrievanceList(
          sender,
          session,
          fetchImpl,
          env,
          auth,
          deps,
        );
        return;
      }

      // 2. Project Search query
      if (session.step === 'SEARCH_PROJECT') {
        session.searchQuery = textMsg;
        session.page = 1;
        await this.sendProjectList(sender, session, fetchImpl, env, auth, deps);
        return;
      }

      // 3. Grievance Progress Note input
      if (
        session.step === 'ENTER_GRIEVANCE_NOTE' &&
        session.recordId &&
        session.selectedStageIndex != null &&
        session.selectedStatus
      ) {
        const note = textMsg.toLowerCase() === 'skip' ? '' : textMsg;
        session.enteredNote = note;
        session.step = 'CONFIRM_GRIEVANCE';
        await this.sendGrievanceReviewConfirmation(
          sender,
          session,
          session.recordId,
          session.selectedStageIndex,
          session.selectedStatus,
          note,
          fetchImpl,
          env,
          auth,
        );
        return;
      }

      // 4. Project Remarks input
      if (
        session.step === 'ENTER_PROJECT_REMARKS' &&
        session.recordId &&
        session.selectedStageIndex != null &&
        session.selectedStatus
      ) {
        const remarks = textMsg.toLowerCase() === 'skip' ? '' : textMsg;
        session.enteredNote = remarks;
        session.step = 'CONFIRM_PROJECT';
        await this.sendProjectReviewConfirmation(
          sender,
          session,
          session.recordId,
          session.selectedStageIndex,
          session.selectedStatus,
          remarks,
          fetchImpl,
          env,
          auth,
        );
        return;
      }

      // 5. Default keyword / reference number search fallback
      if (textMsg.length >= 2 && !isGreetingOnly(textMsg)) {
        session.searchQuery = textMsg;
        session.page = 1;
        if (session.module === 'projects') {
          await this.sendProjectList(
            sender,
            session,
            fetchImpl,
            env,
            auth,
            deps,
          );
        } else {
          await this.sendGrievanceList(
            sender,
            session,
            fetchImpl,
            env,
            auth,
            deps,
          );
        }
        return;
      }
    }

    // Default fallback
    this.clearSession(sender);
    await this.sendDepartmentMainMenu(sender, fetchImpl, env, auth);
  }

  // =========================================================================
  // MENUS PRESENTATION
  // =========================================================================

  /**
   * 1. Department Operations Main Menu
   */
  async sendDepartmentMainMenu(
    sender: string,
    fetchImpl: typeof fetch,
    env: NodeJS.ProcessEnv,
    auth: DeptAuthResult,
    prefixNotice?: string,
  ): Promise<void> {
    const greeting = auth.name ? `Welcome, *${auth.name}*!` : 'Welcome!';
    const deptInfo = auth.department
      ? `\n*Department Scope:* ${auth.department}`
      : '';

    const bodyParts = [
      prefixNotice ? `${prefixNotice}\n` : null,
      `🏢 *DEPARTMENT OPERATIONS*`,
      greeting + deptInfo,
      ``,
      `Manage assigned citizen grievances and public works directly in WhatsApp. All updates synchronize immediately with the official database, portals, and reports.`,
      ``,
      `Select an operational module:`,
    ].filter(Boolean);

    const rows: MenuRow[] = [
      {
        id: 'dept:grievances',
        title: 'Grievances',
        description: 'View & update assigned grievances',
      },
      {
        id: 'dept:projects',
        title: 'Projects & Reports',
        description: 'Track projects, milestones & reports',
      },
    ];

    await sendReplyList(sender, bodyParts.join('\n'), rows, {
      button: 'Select Module',
      section: 'Operations Modules',
      fetchImpl,
      env,
    });
  }

  /**
   * Legacy GPM Menu (for backward compatibility with #progress keyword and specs)
   */
  async sendGpmMenu(
    sender: string,
    prefixText?: string,
    fetchImpl: typeof fetch = fetch,
    env: NodeJS.ProcessEnv = process.env,
    auth?: DeptAuthResult,
  ): Promise<void> {
    const title = '📋 *Grievance Progress Manager*';
    const roleNotice = auth?.name
      ? `Welcome, *${auth.name}*!`
      : 'Manage grievance progress natively.';
    const lead = prefixText
      ? `${prefixText}\n\n${title}\n${roleNotice}\n\nSelect an option below:`
      : `${title}\n${roleNotice}\n\nSelect an option below to manage grievance progress without opening external links:`;

    const rows: MenuRow[] = [
      {
        id: 'gpm:assigned',
        title: 'Assigned Grievances',
        description: 'View grievances assigned to your department',
      },
      {
        id: 'gpm:update',
        title: 'Update Progress',
        description: 'Select a grievance and update stage status',
      },
      {
        id: 'gpm:view',
        title: 'View Current Progress',
        description: 'Review progress breakdown across 4 stages',
      },
      {
        id: 'gpm:search',
        title: 'Search by Ref #',
        description: 'Find a grievance by reference number or keyword',
      },
      {
        id: 'gpm:help',
        title: 'Instructions & Help',
        description: 'How to use in-chat progress updates',
      },
      {
        id: 'home',
        title: 'Main Menu',
        description: 'Return to the main chatbot menu',
      },
    ];

    await sendReplyList(sender, lead, rows, {
      button: 'Progress Menu',
      section: 'Grievance Options',
      fetchImpl,
      env,
    });
  }

  /**
   * 2. Department Grievance Submenu
   */
  async sendGrievancesMenu(
    sender: string,
    fetchImpl: typeof fetch,
    env: NodeJS.ProcessEnv,
    auth: DeptAuthResult,
  ): Promise<void> {
    const deptLabel = auth.department ? ` for *${auth.department}*` : '';
    const body = [
      `📋 *GRIEVANCE MANAGEMENT*`,
      `Authorized Grievance Operations${deptLabel}.`,
      ``,
      `• *View Assigned Grievances:* Inspect citizen complaints assigned to your department.`,
      `• *Update Grievance Progress:* Record stage progress, status changes, and field notes.`,
      `• *View Current Progress:* Detailed 4-stage tracking and completion breakdown.`,
      `• *Recently Updated:* Review recently modified grievances.`,
      ``,
      `Select an action below:`,
    ].join('\n');

    const rows: MenuRow[] = [
      {
        id: 'dept:g:assigned',
        title: 'Assigned Grievances',
        description: 'View grievances assigned to you',
      },
      {
        id: 'dept:g:update',
        title: 'Update Progress',
        description: 'Update stage, status, and notes',
      },
      {
        id: 'dept:g:view',
        title: 'Current Progress',
        description: 'View 4-stage completion details',
      },
      {
        id: 'dept:g:recent',
        title: 'Recently Updated',
        description: 'View recently modified issues',
      },
      {
        id: 'dept:menu',
        title: 'Department Menu',
        description: 'Return to Department Operations',
      },
    ];

    await sendReplyList(sender, body, rows, {
      button: 'Grievance Menu',
      section: 'Grievance Actions',
      fetchImpl,
      env,
    });
  }

  /**
   * 3. Department Projects & Reports Submenu
   */
  async sendProjectsMenu(
    sender: string,
    fetchImpl: typeof fetch,
    env: NodeJS.ProcessEnv,
    auth: DeptAuthResult,
  ): Promise<void> {
    const deptLabel = auth.department ? ` for *${auth.department}*` : '';
    const body = [
      `🏗️ *PROJECTS & REPORTS*`,
      `Department Project Tracking & Reporting${deptLabel}.`,
      ``,
      `• *View Assigned Projects:* List active development works in your department.`,
      `• *Update Project Progress:* Update execution milestones, status & remarks.`,
      `• *View Project Details:* Comprehensive milestone progress & metrics.`,
      `• *View Project Reports:* Formatted summary report directly inside WhatsApp.`,
      ``,
      `Select an action below:`,
    ].join('\n');

    const rows: MenuRow[] = [
      {
        id: 'dept:p:assigned',
        title: 'Assigned Projects',
        description: 'View projects in your department',
      },
      {
        id: 'dept:p:update',
        title: 'Update Progress',
        description: 'Update milestone status & remarks',
      },
      {
        id: 'dept:p:details',
        title: 'Project Details',
        description: 'Inspect milestones & information',
      },
      {
        id: 'dept:p:reports',
        title: 'Project Reports',
        description: 'Summarized project reports in chat',
      },
      {
        id: 'dept:menu',
        title: 'Department Menu',
        description: 'Return to Department Operations',
      },
    ];

    await sendReplyList(sender, body, rows, {
      button: 'Project Menu',
      section: 'Project Actions',
      fetchImpl,
      env,
    });
  }

  // =========================================================================
  // GRIEVANCE WORKFLOW IMPLEMENTATION
  // =========================================================================

  private async sendGrievanceList(
    sender: string,
    session: DeptSession,
    fetchImpl: typeof fetch,
    env: NodeJS.ProcessEnv,
    auth: DeptAuthResult,
    deps: { records?: unknown },
  ): Promise<void> {
    const items = await this.loadAuthorizedRecords('grievances', auth, deps);

    let filtered = items;
    if (session.searchQuery) {
      filtered = this.filterRecords(items, session.searchQuery);
    }

    if (filtered.length === 0) {
      const notice = session.searchQuery
        ? `No grievances found matching query "*${session.searchQuery}*".`
        : `No grievances currently assigned to your department.`;

      const buttons: ReplyButton[] = [
        { id: 'dept:g:search', title: 'Search Again' },
        { id: 'dept:grievances', title: 'Grievance Menu' },
        { id: 'dept:menu', title: 'Main Menu' },
      ];
      await sendReplyButtons(
        sender,
        `${notice}\n\nWhat would you like to do?`,
        buttons,
        fetchImpl,
        env,
      );
      return;
    }

    // Direct single search match
    if (session.searchQuery && filtered.length === 1) {
      await this.handleGrievanceSelection(
        sender,
        session,
        filtered[0].id,
        fetchImpl,
        env,
        auth,
        deps,
      );
      return;
    }

    const totalPages = Math.ceil(filtered.length / PAGE_SIZE) || 1;
    const page = Math.min(Math.max(1, session.page), totalPages);
    session.page = page;

    const start = (page - 1) * PAGE_SIZE;
    const pageItems = filtered.slice(start, start + PAGE_SIZE);

    const actionText =
      session.action === 'update'
        ? 'Tap to update progress:'
        : 'Tap to inspect details:';
    const body = [
      `📋 *ASSIGNED GRIEVANCES* (Page ${page}/${totalPages})`,
      session.searchQuery
        ? `Search: "*${session.searchQuery}*" (${filtered.length} found)`
        : `Total: ${filtered.length} grievance(s)`,
      ``,
      actionText,
    ].join('\n');

    const rows: MenuRow[] = pageItems.map((g) => {
      const ref = g.srNumber ? `[${g.srNumber.slice(-8)}] ` : '';
      const title = clip(`${ref}${g.title || g.fullName || 'Grievance'}`, 24);
      const loc = g.place || g.village || 'Palnadu';
      const stat = g.status || 'Open';
      const desc = clip(`${loc} · ${stat} · ${g.date || ''}`, 72);
      const prefix =
        session.action === 'update' ? 'dept:g:up_pick:' : 'dept:g:pick:';
      return {
        id: `${prefix}${g.id}`,
        title,
        description: desc,
      };
    });

    if (page < totalPages) {
      rows.push({
        id: `gpm:page:${page + 1}`,
        title: '▶ Next Page',
        description: `View page ${page + 1} of ${totalPages}`,
      });
    }
    if (page > 1) {
      rows.push({
        id: `gpm:page:${page - 1}`,
        title: '◀ Previous Page',
        description: `View page ${page - 1} of ${totalPages}`,
      });
    }

    rows.push({
      id: 'gpm:search',
      title: '🔍 Search by Ref #',
      description: 'Search by reference number or keyword',
    });
    rows.push({
      id: 'dept:grievances',
      title: '↩ Back to Grievances',
      description: 'Return to Grievances menu',
    });

    await sendReplyList(sender, body, rows, {
      button: 'Select Grievance',
      section: 'Assigned Grievances',
      fetchImpl,
      env,
    });
  }

  private async handleGrievanceSelection(
    sender: string,
    session: DeptSession,
    id: string,
    fetchImpl: typeof fetch,
    env: NodeJS.ProcessEnv,
    auth: DeptAuthResult,
    deps: { records?: unknown },
  ): Promise<void> {
    const record = await this.getRecordById('grievances', id, deps);
    if (!record) {
      await sendTextMessage(
        sender,
        '⚠️ The selected grievance could not be found or is no longer available.',
        fetchImpl,
        env,
      );
      await this.sendGrievancesMenu(sender, fetchImpl, env, auth);
      return;
    }

    session.recordId = record.id;
    session.recordTitle = record.title || record.fullName || 'Grievance';
    session.record = record;

    if (session.action === 'update') {
      session.step = 'SELECT_GRIEVANCE_STAGE';
      await this.sendGrievanceStagePrompt(sender, record, fetchImpl, env);
    } else {
      session.step = 'REVIEW_PROGRESS';
      await this.sendGrievanceOverview(sender, record, fetchImpl, env, auth);
    }
  }

  private async sendGrievanceOverview(
    sender: string,
    record: WorkspaceRecord,
    fetchImpl: typeof fetch,
    env: NodeJS.ProcessEnv,
    auth: DeptAuthResult,
  ): Promise<void> {
    const stages =
      record.progressStages && record.progressStages.length
        ? record.progressStages
        : defaultStages();
    const counts = stageCounts(stages);
    const bar = progressBar(counts.completed, stages.length);
    const fallbackLink = record.progressToken
      ? progressPageUrl(env, record.progressToken)
      : '';

    const stageLines = stages.map((stg, i) => {
      const icon =
        stg.status === 'Completed'
          ? '✅'
          : stg.status === 'In progress'
            ? '🔄'
            : '⏳';
      const noteStr = stg.note ? `\n   _Note: ${stg.note}_` : '';
      return `${i + 1}. ${stg.name}: ${icon} ${stg.status}${noteStr}`;
    });

    const body = [
      `📋 *Grievance Progress Details*`,
      `*Ref #:* ${record.srNumber || record.id}`,
      `*Title:* ${record.title || record.fullName}`,
      record.detail ? `*Detail:* ${clip(record.detail, 250)}` : null,
      `*Department:* ${record.followUpDepartment || record.department || 'General administration'}`,
      record.place || record.village
        ? `*Location:* ${[record.village, record.mandal, record.place].filter(Boolean).join(', ')}`
        : null,
      record.assemblyConstituency
        ? `*Constituency:* ${record.assemblyConstituency}`
        : null,
      `*Current Status:* *${record.status || 'Open'}*`,
      ``,
      `*Progress Overview:* ${counts.completed} of 4 stages completed (${Math.round((counts.completed / 4) * 100)}%)`,
      bar,
      ``,
      `*Stages:*`,
      ...stageLines,
      record.progressRemarks
        ? `\n*Latest Remarks:* ${record.progressRemarks}`
        : null,
    ]
      .filter(Boolean)
      .join('\n');

    const buttons: ReplyButton[] = [
      { id: `gpm:up_pick:${record.id}`, title: 'Update Progress' },
      { id: 'gpm:assigned', title: 'Assigned List' },
      { id: 'dept:menu', title: 'Department Menu' },
    ];

    await sendReplyButtons(sender, body, buttons, fetchImpl, env);
  }

  private async sendGrievanceStagePrompt(
    sender: string,
    record: WorkspaceRecord,
    fetchImpl: typeof fetch,
    env: NodeJS.ProcessEnv,
  ): Promise<void> {
    const stages =
      record.progressStages && record.progressStages.length
        ? record.progressStages
        : defaultStages();
    const counts = stageCounts(stages);
    const bar = progressBar(counts.completed, stages.length);

    const body = [
      `🎯 *UPDATE PROGRESS: SELECT STAGE*`,
      `*Grievance:* ${record.srNumber || record.id} — ${clip(record.title, 40)}`,
      `*Current Progress:* ${bar}`,
      ``,
      `Which stage would you like to update?`,
    ].join('\n');

    const rows: MenuRow[] = stages.map((stg, i) => {
      const icon =
        stg.status === 'Completed'
          ? '✅'
          : stg.status === 'In progress'
            ? '🔄'
            : '⏳';
      return {
        id: `gpm:stage:${record.id}:${i}`,
        title: clip(`${i + 1}. ${stg.name}`, 24),
        description: clip(
          `${icon} Current: ${stg.status}${stg.note ? ` · ${stg.note}` : ''}`,
          72,
        ),
      };
    });

    rows.push({
      id: `gpm:pick:${record.id}`,
      title: '↩ Grievance Details',
      description: 'Back to grievance overview',
    });
    rows.push({
      id: 'gpm:menu',
      title: '↩ Progress Menu',
      description: 'Return to Progress menu',
    });

    await sendReplyList(sender, body, rows, {
      button: 'Select Stage',
      section: 'Progress Stages',
      fetchImpl,
      env,
    });
  }

  private async handleGrievanceStageChoice(
    sender: string,
    session: DeptSession,
    id: string,
    stageIdx: number,
    fetchImpl: typeof fetch,
    env: NodeJS.ProcessEnv,
    auth: DeptAuthResult,
    deps: { records?: unknown },
  ): Promise<void> {
    const record = await this.getRecordById('grievances', id, deps);
    if (!record) {
      await sendTextMessage(sender, '⚠️ Record not found.', fetchImpl, env);
      return;
    }
    const stages =
      record.progressStages && record.progressStages.length
        ? record.progressStages
        : defaultStages();
    if (stageIdx < 0 || stageIdx >= stages.length) {
      await sendTextMessage(
        sender,
        '⚠️ Invalid stage selection.',
        fetchImpl,
        env,
      );
      return;
    }

    const currentStage = stages[stageIdx];
    session.recordId = record.id;
    session.recordTitle = record.title;
    session.record = record;
    session.selectedStageIndex = stageIdx;
    session.selectedStageName = currentStage.name;
    session.previousStatus = currentStage.status;
    session.step = 'SELECT_GRIEVANCE_STATUS';

    const body = [
      `📊 *SET STAGE STATUS*`,
      `*Grievance:* ${record.srNumber || record.id}`,
      `*Stage:* ${currentStage.name}`,
      `*Current Status:* *${currentStage.status}*`,
      ``,
      `Select the new status for this stage:`,
    ].join('\n');

    const buttons: ReplyButton[] = [
      { id: `gpm:status:${record.id}:${stageIdx}:Pending`, title: 'Pending' },
      {
        id: `gpm:status:${record.id}:${stageIdx}:In progress`,
        title: 'In Progress',
      },
      {
        id: `gpm:status:${record.id}:${stageIdx}:Completed`,
        title: 'Completed',
      },
    ];

    await sendReplyButtons(sender, body, buttons, fetchImpl, env);
  }

  private async handleGrievanceStatusChoice(
    sender: string,
    session: DeptSession,
    id: string,
    stageIdx: number,
    statusVal: string,
    fetchImpl: typeof fetch,
    env: NodeJS.ProcessEnv,
    auth: DeptAuthResult,
    deps: { records?: unknown },
  ): Promise<void> {
    if (!VALID_STAGE_STATUSES.includes(statusVal as StageStatus)) {
      await sendTextMessage(sender, '⚠️ Invalid status value.', fetchImpl, env);
      return;
    }
    const record = await this.getRecordById('grievances', id, deps);
    if (!record) {
      await sendTextMessage(sender, '⚠️ Record not found.', fetchImpl, env);
      return;
    }

    session.selectedStatus = statusVal as StageStatus;
    session.step = 'ENTER_GRIEVANCE_NOTE';

    const body = [
      `📝 *ENTER PROGRESS NOTE*`,
      `*Grievance:* ${record.srNumber || record.id}`,
      `*Stage:* ${session.selectedStageName || 'Stage'}`,
      `*Proposed Status:* *${statusVal}*`,
      ``,
      `Please reply with a brief note describing the field action taken (e.g., _Inspection done by AE Ramesh, pipe replacement scheduled_).`,
      ``,
      `• Reply with your note directly.`,
      `• Or reply *skip* to leave the existing note unchanged.`,
      `• Reply *cancel* anytime to abort.`,
    ].join('\n');

    await sendTextMessage(sender, body, fetchImpl, env);
  }

  private async sendGrievanceReviewConfirmation(
    sender: string,
    session: DeptSession,
    id: string,
    stageIdx: number,
    statusVal: StageStatus,
    note: string,
    fetchImpl: typeof fetch,
    env: NodeJS.ProcessEnv,
    auth: DeptAuthResult,
  ): Promise<void> {
    const record = session.record;
    const body = [
      `🔍 *REVIEW PROPOSED UPDATE*`,
      ``,
      `*Grievance:* ${record?.srNumber || id} — ${clip(record?.title || '', 40)}`,
      `*Department:* ${record?.followUpDepartment || record?.department || auth.department || 'Department'}`,
      record?.place ? `*Location:* ${record.place}` : null,
      `*Stage:* ${session.selectedStageName || STAGE_NAMES[stageIdx]}`,
      `*Previous Status:* ${session.previousStatus || 'Pending'}`,
      `*Proposed Status:* *${statusVal}*`,
      `*Progress Note:* ${note || '_(none / unchanged)_'}`,
      ``,
      `Please confirm this update. It will be saved directly to the database.`,
    ]
      .filter(Boolean)
      .join('\n');

    const buttons: ReplyButton[] = [
      {
        id: `gpm:conf:${id}:${stageIdx}:${statusVal}`,
        title: 'Confirm & Save',
      },
      { id: 'gpm:cancel', title: 'Cancel' },
    ];

    await sendReplyButtons(sender, body, buttons, fetchImpl, env);
  }

  private async commitGrievanceUpdate(
    sender: string,
    session: DeptSession,
    id: string,
    stageIdx: number,
    statusVal: string,
    fetchImpl: typeof fetch,
    env: NodeJS.ProcessEnv,
    auth: DeptAuthResult,
  ): Promise<void> {
    const idempotencyKey = `commit:g:${id}:${stageIdx}:${statusVal}:${digits(sender)}`;
    const cached = this.idempotencyCache.get(idempotencyKey);
    const now = Date.now();
    if (cached && now - cached.timestamp < IDEMPOTENCY_TTL_MS) {
      await sendTextMessage(sender, cached.summary, fetchImpl, env);
      this.clearSession(sender);
      return;
    }

    if (!this.workspace) {
      await sendTextMessage(
        sender,
        '⚠️ Persistence service unavailable.',
        fetchImpl,
        env,
      );
      return;
    }

    try {
      const record = await this.workspace.get(id);
      const stages =
        record.progressStages && record.progressStages.length
          ? [...record.progressStages]
          : defaultStages();

      const stageName = stages[stageIdx]?.name || STAGE_NAMES[stageIdx];
      const prevNote = stages[stageIdx]?.note || '';
      const finalNote =
        session.enteredNote !== undefined && session.enteredNote !== ''
          ? session.enteredNote
          : prevNote;

      stages[stageIdx] = {
        name: stageName,
        status: statusVal as StageStatus,
        note: finalNote,
      };

      const remarks = finalNote || record.progressRemarks || '';
      const dept =
        record.followUpDepartment ||
        record.department ||
        auth.department ||
        'Department';

      const updated = await this.workspace.saveProgress(
        record.progressToken || record.id,
        {
          stages,
          remarks,
          department: dept,
        },
      );

      const counts = stageCounts(updated.progressStages || stages);
      const bar = progressBar(counts.completed, stages.length);

      const summary = [
        `✅ *GRIEVANCE PROGRESS SAVED*`,
        ``,
        `*Grievance:* ${updated.srNumber || record.srNumber || id} — ${clip(updated.title || record.title, 40)}`,
        `*Stage:* ${stageName} → *${statusVal}*`,
        `*Overall Progress:* ${bar}`,
        `*Grievance Status:* *${updated.status}*`,
        finalNote ? `*Note Recorded:* ${finalNote}` : null,
        ``,
        `*Authoritative Sync:* Database, website portal, analytics & reports updated.`,
      ]
        .filter(Boolean)
        .join('\n');

      this.idempotencyCache.set(idempotencyKey, { timestamp: now, summary });
      this.clearSession(sender);

      const buttons: ReplyButton[] = [
        { id: `gpm:up_pick:${id}`, title: 'Update Another' },
        { id: 'gpm:assigned', title: 'Assigned List' },
        { id: 'dept:menu', title: 'Department Menu' },
      ];

      await sendReplyButtons(sender, summary, buttons, fetchImpl, env);
      this.logger.log(
        `Grievance #${id} progress updated to ${statusVal} by ${sender}`,
      );
    } catch (err) {
      this.logger.error(
        `Failed to save grievance progress: ${err instanceof Error ? err.message : 'error'}`,
      );
      await sendTextMessage(
        sender,
        '❌ Failed to save update to database. Please try again.',
        fetchImpl,
        env,
      );
    }
  }

  private async sendRecentlyUpdatedGrievances(
    sender: string,
    fetchImpl: typeof fetch,
    env: NodeJS.ProcessEnv,
    auth: DeptAuthResult,
    deps: { records?: unknown },
  ): Promise<void> {
    const items = await this.loadAuthorizedRecords('grievances', auth, deps);
    const withUpdates = items.filter(
      (g) =>
        g.progressUpdatedAt ||
        (g.progressHistory && g.progressHistory.length > 0),
    );

    withUpdates.sort((a, b) => {
      const ta = new Date(a.progressUpdatedAt || a.date || 0).getTime();
      const tb = new Date(b.progressUpdatedAt || b.date || 0).getTime();
      return tb - ta;
    });

    if (withUpdates.length === 0) {
      const buttons: ReplyButton[] = [
        { id: 'dept:g:assigned', title: 'Assigned Grievances' },
        { id: 'dept:grievances', title: 'Grievance Menu' },
      ];
      await sendReplyButtons(
        sender,
        'No recently updated grievances found for your department.',
        buttons,
        fetchImpl,
        env,
      );
      return;
    }

    const top5 = withUpdates.slice(0, 5);
    const body = [
      `🕒 *RECENTLY UPDATED GRIEVANCES*`,
      `Showing the last ${top5.length} updated record(s):`,
      ``,
      ...top5.map((g, i) => {
        const counts = stageCounts(g.progressStages || defaultStages());
        const time = g.progressUpdatedAt
          ? new Date(g.progressUpdatedAt).toLocaleDateString('en-IN')
          : '';
        return `${i + 1}. *${g.srNumber || g.id}* — ${clip(g.title, 30)}\n   Status: ${g.status} · Progress: ${counts.completed}/4${time ? ` · ${time}` : ''}`;
      }),
    ].join('\n');

    const buttons: ReplyButton[] = [
      { id: 'dept:g:assigned', title: 'Assigned List' },
      { id: 'dept:grievances', title: 'Grievance Menu' },
      { id: 'dept:menu', title: 'Department Menu' },
    ];

    await sendReplyButtons(sender, body, buttons, fetchImpl, env);
  }

  // =========================================================================
  // PROJECT WORKFLOW IMPLEMENTATION
  // =========================================================================

  private async sendProjectList(
    sender: string,
    session: DeptSession,
    fetchImpl: typeof fetch,
    env: NodeJS.ProcessEnv,
    auth: DeptAuthResult,
    deps: { records?: unknown },
  ): Promise<void> {
    const items = await this.loadAuthorizedRecords('projects', auth, deps);

    let filtered = items;
    if (session.searchQuery) {
      filtered = this.filterRecords(items, session.searchQuery);
    }

    if (filtered.length === 0) {
      const notice = session.searchQuery
        ? `No projects found matching query "*${session.searchQuery}*".`
        : `No projects currently assigned to your department.`;

      const buttons: ReplyButton[] = [
        { id: 'dept:p:search', title: 'Search Again' },
        { id: 'dept:projects', title: 'Projects Menu' },
        { id: 'dept:menu', title: 'Main Menu' },
      ];
      await sendReplyButtons(
        sender,
        `${notice}\n\nWhat would you like to do?`,
        buttons,
        fetchImpl,
        env,
      );
      return;
    }

    if (session.searchQuery && filtered.length === 1) {
      await this.handleProjectSelection(
        sender,
        session,
        filtered[0].id,
        fetchImpl,
        env,
        auth,
        deps,
      );
      return;
    }

    const totalPages = Math.ceil(filtered.length / PAGE_SIZE) || 1;
    const page = Math.min(Math.max(1, session.page), totalPages);
    session.page = page;

    const start = (page - 1) * PAGE_SIZE;
    const pageItems = filtered.slice(start, start + PAGE_SIZE);

    const actionText =
      session.action === 'update'
        ? 'Tap to update milestone:'
        : 'Tap to inspect details:';
    const body = [
      `🏗️ *ASSIGNED PROJECTS* (Page ${page}/${totalPages})`,
      session.searchQuery
        ? `Search: "*${session.searchQuery}*" (${filtered.length} found)`
        : `Total: ${filtered.length} project(s)`,
      ``,
      actionText,
    ].join('\n');

    const rows: MenuRow[] = pageItems.map((p) => {
      const ref = p.srNumber ? `[${p.srNumber.slice(-8)}] ` : '';
      const title = clip(`${ref}${p.title || 'Project'}`, 24);
      const loc = p.place || p.village || 'Constituency';
      const stat = p.status || 'Open';
      const desc = clip(`${loc} · ${stat}`, 72);
      const prefix =
        session.action === 'update' ? 'dept:p:up_pick:' : 'dept:p:pick:';
      return {
        id: `${prefix}${p.id}`,
        title,
        description: desc,
      };
    });

    if (page < totalPages) {
      rows.push({
        id: `dept:p:page:${page + 1}`,
        title: '▶ Next Page',
        description: `View page ${page + 1} of ${totalPages}`,
      });
    }
    if (page > 1) {
      rows.push({
        id: `dept:p:page:${page - 1}`,
        title: '◀ Previous Page',
        description: `View page ${page - 1} of ${totalPages}`,
      });
    }

    rows.push({
      id: 'dept:p:search',
      title: '🔍 Search Projects',
      description: 'Search by project name or ref #',
    });
    rows.push({
      id: 'dept:projects',
      title: '↩ Back to Projects',
      description: 'Return to Projects menu',
    });

    await sendReplyList(sender, body, rows, {
      button: 'Select Project',
      section: 'Assigned Projects',
      fetchImpl,
      env,
    });
  }

  private async handleProjectSelection(
    sender: string,
    session: DeptSession,
    id: string,
    fetchImpl: typeof fetch,
    env: NodeJS.ProcessEnv,
    auth: DeptAuthResult,
    deps: { records?: unknown },
  ): Promise<void> {
    const record = await this.getRecordById('projects', id, deps);
    if (!record) {
      await sendTextMessage(
        sender,
        '⚠️ The selected project could not be found or is no longer available.',
        fetchImpl,
        env,
      );
      await this.sendProjectsMenu(sender, fetchImpl, env, auth);
      return;
    }

    session.recordId = record.id;
    session.recordTitle = record.title || 'Project';
    session.record = record;

    if (session.action === 'update') {
      session.step = 'SELECT_PROJECT_MILESTONE';
      await this.sendProjectMilestonePrompt(sender, record, fetchImpl, env);
    } else {
      session.step = 'REVIEW_PROGRESS';
      await this.sendProjectDetails(sender, record, fetchImpl, env, auth);
    }
  }

  private async sendProjectDetails(
    sender: string,
    record: WorkspaceRecord,
    fetchImpl: typeof fetch,
    env: NodeJS.ProcessEnv,
    auth: DeptAuthResult,
  ): Promise<void> {
    const stages =
      record.progressStages && record.progressStages.length
        ? record.progressStages
        : defaultStages();
    const counts = stageCounts(stages);
    const bar = progressBar(counts.completed, stages.length);

    const stageLines = stages.map((stg, i) => {
      const icon =
        stg.status === 'Completed'
          ? '✅'
          : stg.status === 'In progress'
            ? '🔄'
            : '⏳';
      const noteStr = stg.note ? `\n   _Remarks: ${stg.note}_` : '';
      return `${i + 1}. ${stg.name}: ${icon} *${stg.status}*${noteStr}`;
    });

    const body = [
      `🏗️ *PROJECT DETAILS*`,
      `*Ref #:* ${record.srNumber || record.id}`,
      `*Project:* ${record.title}`,
      record.detail ? `*Description:* ${clip(record.detail, 250)}` : null,
      `*Department:* ${record.followUpDepartment || record.department || 'General administration'}`,
      record.place || record.village
        ? `*Location:* ${[record.village, record.mandal, record.place].filter(Boolean).join(', ')}`
        : null,
      record.assemblyConstituency
        ? `*Constituency:* ${record.assemblyConstituency}`
        : null,
      `*Status:* *${record.status || 'Open'}*`,
      ``,
      `*Milestone Progress:* ${bar}`,
      ``,
      `*Milestones:*`,
      ...stageLines,
      record.progressRemarks
        ? `\n*Latest Remarks:* ${record.progressRemarks}`
        : null,
      record.progressUpdatedAt
        ? `*Updated:* ${new Date(record.progressUpdatedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`
        : null,
    ]
      .filter(Boolean)
      .join('\n');

    const buttons: ReplyButton[] = [
      { id: `dept:p:up_pick:${record.id}`, title: 'Update Progress' },
      { id: 'dept:p:assigned', title: 'Projects List' },
      { id: 'dept:menu', title: 'Department Menu' },
    ];

    await sendReplyButtons(sender, body, buttons, fetchImpl, env);
  }

  private async sendProjectMilestonePrompt(
    sender: string,
    record: WorkspaceRecord,
    fetchImpl: typeof fetch,
    env: NodeJS.ProcessEnv,
  ): Promise<void> {
    const stages =
      record.progressStages && record.progressStages.length
        ? record.progressStages
        : defaultStages();
    const counts = stageCounts(stages);
    const bar = progressBar(counts.completed, stages.length);

    const body = [
      `🎯 *UPDATE PROJECT: SELECT MILESTONE*`,
      `*Project:* ${record.srNumber || record.id} — ${clip(record.title, 40)}`,
      `*Current Progress:* ${bar}`,
      ``,
      `Which milestone would you like to update?`,
    ].join('\n');

    const rows: MenuRow[] = stages.map((stg, i) => {
      const icon =
        stg.status === 'Completed'
          ? '✅'
          : stg.status === 'In progress'
            ? '🔄'
            : '⏳';
      return {
        id: `dept:p:stg:${record.id}:${i}`,
        title: clip(`${i + 1}. ${stg.name}`, 24),
        description: clip(
          `${icon} Current: ${stg.status}${stg.note ? ` · ${stg.note}` : ''}`,
          72,
        ),
      };
    });

    rows.push({
      id: `dept:p:pick:${record.id}`,
      title: '↩ Project Details',
      description: 'Back to project overview',
    });
    rows.push({
      id: 'dept:projects',
      title: '↩ Projects Menu',
      description: 'Return to Projects menu',
    });

    await sendReplyList(sender, body, rows, {
      button: 'Select Milestone',
      section: 'Project Milestones',
      fetchImpl,
      env,
    });
  }

  private async handleProjectMilestoneChoice(
    sender: string,
    session: DeptSession,
    id: string,
    stageIdx: number,
    fetchImpl: typeof fetch,
    env: NodeJS.ProcessEnv,
    auth: DeptAuthResult,
    deps: { records?: unknown },
  ): Promise<void> {
    const record = await this.getRecordById('projects', id, deps);
    if (!record) {
      await sendTextMessage(
        sender,
        '⚠️ Project record not found.',
        fetchImpl,
        env,
      );
      return;
    }
    const stages =
      record.progressStages && record.progressStages.length
        ? record.progressStages
        : defaultStages();
    if (stageIdx < 0 || stageIdx >= stages.length) {
      await sendTextMessage(
        sender,
        '⚠️ Invalid milestone selection.',
        fetchImpl,
        env,
      );
      return;
    }

    const currentStage = stages[stageIdx];
    session.recordId = record.id;
    session.recordTitle = record.title;
    session.record = record;
    session.selectedStageIndex = stageIdx;
    session.selectedStageName = currentStage.name;
    session.previousStatus = currentStage.status;
    session.step = 'SELECT_PROJECT_STATUS';

    const body = [
      `📊 *SET MILESTONE STATUS*`,
      `*Project:* ${record.srNumber || record.id}`,
      `*Milestone:* ${currentStage.name}`,
      `*Current Status:* *${currentStage.status}*`,
      ``,
      `Select the new status for this milestone:`,
    ].join('\n');

    const buttons: ReplyButton[] = [
      { id: `dept:p:sts:${record.id}:${stageIdx}:Pending`, title: 'Pending' },
      {
        id: `dept:p:sts:${record.id}:${stageIdx}:In progress`,
        title: 'In Progress',
      },
      {
        id: `dept:p:sts:${record.id}:${stageIdx}:Completed`,
        title: 'Completed',
      },
    ];

    await sendReplyButtons(sender, body, buttons, fetchImpl, env);
  }

  private async handleProjectStatusChoice(
    sender: string,
    session: DeptSession,
    id: string,
    stageIdx: number,
    statusVal: string,
    fetchImpl: typeof fetch,
    env: NodeJS.ProcessEnv,
    auth: DeptAuthResult,
    deps: { records?: unknown },
  ): Promise<void> {
    if (!VALID_STAGE_STATUSES.includes(statusVal as StageStatus)) {
      await sendTextMessage(sender, '⚠️ Invalid status value.', fetchImpl, env);
      return;
    }
    const record = await this.getRecordById('projects', id, deps);
    if (!record) {
      await sendTextMessage(sender, '⚠️ Project not found.', fetchImpl, env);
      return;
    }

    session.selectedStatus = statusVal as StageStatus;
    session.step = 'ENTER_PROJECT_REMARKS';

    const body = [
      `📝 *ENTER MILESTONE REMARKS*`,
      `*Project:* ${record.srNumber || record.id}`,
      `*Milestone:* ${session.selectedStageName || 'Milestone'}`,
      `*Proposed Status:* *${statusVal}*`,
      ``,
      `Please reply with remarks describing the field progress (e.g., _Earthwork complete, 2km pipeline laid_).`,
      ``,
      `• Reply with your remarks.`,
      `• Or reply *skip* to leave remarks unchanged.`,
      `• Reply *cancel* anytime to abort.`,
    ].join('\n');

    await sendTextMessage(sender, body, fetchImpl, env);
  }

  private async sendProjectReviewConfirmation(
    sender: string,
    session: DeptSession,
    id: string,
    stageIdx: number,
    statusVal: StageStatus,
    remarks: string,
    fetchImpl: typeof fetch,
    env: NodeJS.ProcessEnv,
    auth: DeptAuthResult,
  ): Promise<void> {
    const record = session.record;
    const body = [
      `🔍 *REVIEW PROJECT UPDATE*`,
      ``,
      `*Project:* ${record?.srNumber || id} — ${clip(record?.title || '', 40)}`,
      `*Department:* ${record?.followUpDepartment || record?.department || auth.department || 'Department'}`,
      record?.place ? `*Location:* ${record.place}` : null,
      `*Milestone:* ${session.selectedStageName || STAGE_NAMES[stageIdx]}`,
      `*Previous Status:* ${session.previousStatus || 'Pending'}`,
      `*Proposed Status:* *${statusVal}*`,
      `*Remarks:* ${remarks || '_(none / unchanged)_'}`,
      ``,
      `Please confirm this update. It will be saved directly to the database.`,
    ]
      .filter(Boolean)
      .join('\n');

    const buttons: ReplyButton[] = [
      {
        id: `dept:p:conf:${id}:${stageIdx}:${statusVal}`,
        title: 'Confirm & Save',
      },
      { id: 'dept:cancel', title: 'Cancel' },
    ];

    await sendReplyButtons(sender, body, buttons, fetchImpl, env);
  }

  private async commitProjectUpdate(
    sender: string,
    session: DeptSession,
    id: string,
    stageIdx: number,
    statusVal: string,
    fetchImpl: typeof fetch,
    env: NodeJS.ProcessEnv,
    auth: DeptAuthResult,
  ): Promise<void> {
    const idempotencyKey = `commit:p:${id}:${stageIdx}:${statusVal}:${digits(sender)}`;
    const cached = this.idempotencyCache.get(idempotencyKey);
    const now = Date.now();
    if (cached && now - cached.timestamp < IDEMPOTENCY_TTL_MS) {
      await sendTextMessage(sender, cached.summary, fetchImpl, env);
      this.clearSession(sender);
      return;
    }

    if (!this.workspace) {
      await sendTextMessage(
        sender,
        '⚠️ Persistence service unavailable.',
        fetchImpl,
        env,
      );
      return;
    }

    try {
      const record = await this.workspace.get(id);
      const stages =
        record.progressStages && record.progressStages.length
          ? [...record.progressStages]
          : defaultStages();

      const stageName = stages[stageIdx]?.name || STAGE_NAMES[stageIdx];
      const prevNote = stages[stageIdx]?.note || '';
      const finalRemarks =
        session.enteredNote !== undefined && session.enteredNote !== ''
          ? session.enteredNote
          : prevNote;

      stages[stageIdx] = {
        name: stageName,
        status: statusVal as StageStatus,
        note: finalRemarks,
      };

      const remarks = finalRemarks || record.progressRemarks || '';
      const dept =
        record.followUpDepartment ||
        record.department ||
        auth.department ||
        'Department';

      const updated = await this.workspace.saveProgress(
        record.progressToken || record.id,
        {
          stages,
          remarks,
          department: dept,
        },
      );

      const counts = stageCounts(updated.progressStages || stages);
      const bar = progressBar(counts.completed, stages.length);

      const summary = [
        `✅ *PROJECT PROGRESS SAVED*`,
        ``,
        `*Project:* ${updated.srNumber || record.srNumber || id} — ${clip(updated.title || record.title, 40)}`,
        `*Milestone:* ${stageName} → *${statusVal}*`,
        `*Overall Progress:* ${bar}`,
        `*Project Status:* *${updated.status}*`,
        finalRemarks ? `*Remarks Recorded:* ${finalRemarks}` : null,
        ``,
        `*Authoritative Sync:* Database, website, analytics & reports updated.`,
      ]
        .filter(Boolean)
        .join('\n');

      this.idempotencyCache.set(idempotencyKey, { timestamp: now, summary });
      this.clearSession(sender);

      const buttons: ReplyButton[] = [
        { id: `dept:p:up_pick:${id}`, title: 'Update Another' },
        { id: 'dept:p:assigned', title: 'Projects List' },
        { id: 'dept:menu', title: 'Department Menu' },
      ];

      await sendReplyButtons(sender, summary, buttons, fetchImpl, env);
      this.logger.log(
        `Project #${id} milestone updated to ${statusVal} by ${sender}`,
      );
    } catch (err) {
      this.logger.error(
        `Failed to save project milestone: ${err instanceof Error ? err.message : 'error'}`,
      );
      await sendTextMessage(
        sender,
        '❌ Failed to save update to database. Please try again.',
        fetchImpl,
        env,
      );
    }
  }

  private async sendProjectReports(
    sender: string,
    fetchImpl: typeof fetch,
    env: NodeJS.ProcessEnv,
    auth: DeptAuthResult,
    deps: { records?: unknown },
  ): Promise<void> {
    const projects = await this.loadAuthorizedRecords('projects', auth, deps);

    if (projects.length === 0) {
      const buttons: ReplyButton[] = [
        { id: 'dept:p:assigned', title: 'Assigned Projects' },
        { id: 'dept:projects', title: 'Projects Menu' },
      ];
      await sendReplyButtons(
        sender,
        'No projects found to generate a report.',
        buttons,
        fetchImpl,
        env,
      );
      return;
    }

    const total = projects.length;
    let completedCount = 0;
    let inProgressCount = 0;
    let pendingCount = 0;

    for (const p of projects) {
      const stat = (p.status || '').toLowerCase();
      if (stat === 'completed' || stat === 'resolved') {
        completedCount++;
      } else if (stat === 'in progress') {
        inProgressCount++;
      } else {
        pendingCount++;
      }
    }

    const compPct = Math.round((completedCount / total) * 100);
    const progPct = Math.round((inProgressCount / total) * 100);
    const pendPct = Math.round((pendingCount / total) * 100);

    const nowStr = new Date().toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: 'Asia/Kolkata',
    });

    const projectHighlights = projects.slice(0, 4).map((p, idx) => {
      const counts = stageCounts(p.progressStages || defaultStages());
      const bar = progressBar(counts.completed, 4);
      return `${idx + 1}. *${p.title}*\n   📍 ${p.place || 'Constituency'} · Status: *${p.status || 'Open'}*\n   Milestones: ${bar}`;
    });

    const body = [
      `📊 *DEPARTMENT PROJECT REPORT*`,
      `🏢 *Scope:* ${auth.department || 'All Departments'}`,
      `📅 *Date:* ${nowStr}`,
      ``,
      `*Executive Summary:*`,
      `• Total Works: *${total}*`,
      `• ✅ Completed: *${completedCount}* (${compPct}%)`,
      `• 🔄 In Progress: *${inProgressCount}* (${progPct}%)`,
      `• ⏳ Pending / Open: *${pendingCount}* (${pendPct}%)`,
      ``,
      `*Key Projects & Milestones:*`,
      ...projectHighlights,
      projects.length > 4
        ? `\n_...and ${projects.length - 4} more project(s)._`
        : null,
      ``,
      `_All data derived directly from the authoritative database._`,
    ]
      .filter(Boolean)
      .join('\n');

    const buttons: ReplyButton[] = [
      { id: 'dept:p:assigned', title: 'View Projects' },
      { id: 'dept:p:update', title: 'Update Milestone' },
      { id: 'dept:menu', title: 'Department Menu' },
    ];

    await sendReplyButtons(sender, body, buttons, fetchImpl, env);
  }

  private async sendGpmHelp(
    sender: string,
    fetchImpl: typeof fetch,
    env: NodeJS.ProcessEnv,
  ): Promise<void> {
    const helpText = [
      `ℹ️ *Grievance Progress Manager - Help*`,
      ``,
      `This tool enables authorized administrators and department officers to manage and update grievance progress directly within WhatsApp without an external web browser.`,
      ``,
      `*How to use:*`,
      `1️⃣ Tap *View Assigned Grievances* or *Update Grievance Progress*.`,
      `2️⃣ Choose a grievance from the list, or tap *Search by Ref #*.`,
      `3️⃣ Review the 4 stages: _Work started, Inspection, Work in progress, Closing and handover_.`,
      `4️⃣ Select which stage to update.`,
      `5️⃣ Select status: _Pending, In Progress, or Completed_.`,
      `6️⃣ Enter a brief note describing the action taken (or reply _skip_).`,
      `7️⃣ Review previous vs proposed status and tap *Confirm & Save*.`,
      ``,
      `*Commands:*`,
      `• Reply *search* to find by reference number or keyword.`,
      `• Reply *cancel* anytime to abort an update.`,
      `• Reply *progress* or *#progress* to return to the menu.`,
      `• All updates persist directly to the database and sync instantly with website and reports.`,
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

  private async loadAuthorizedRecords(
    section: 'grievances' | 'projects',
    auth: DeptAuthResult,
    deps: { records?: unknown },
  ): Promise<WorkspaceRecord[]> {
    let all: WorkspaceRecord[] = [];

    if (deps.records && Array.isArray(deps.records)) {
      all = (deps.records as WorkspaceRecord[]).filter(
        (r) => r.section === section,
      );
    } else if (this.workspace) {
      try {
        all = await this.workspace.list(section);
      } catch (err) {
        this.logger.warn(
          `Could not load ${section} records from workspace: ${err}`,
        );
      }
    }

    if (all.length === 0 && this.db) {
      try {
        const ok = await this.db.ensureConnected();
        if (ok) {
          const docs = await this.db
            .collection('mediasphere.documents')
            .find({ section })
            .sort({ createdAt: -1 })
            .limit(100)
            .toArray();
          all = docs.map((d: any) => ({
            id: String(d._id),
            section,
            title: d.title || d.fullName || '',
            detail: d.detail || '',
            status: d.status || 'Open',
            date: d.date || d.createdAt || '',
            createdBy: d.createdBy || '',
            followUpDepartment: d.followUpDepartment || d.department || '',
            department: d.department || d.followUpDepartment || '',
            place: d.place || '',
            leader: d.leader || '',
            srNumber: d.srNumber || '',
            fullName: d.fullName || d.title || '',
            contactNumber: d.contactNumber || d.reporterPhone || '',
            address: d.address || '',
            email: d.email || '',
            progressToken: d.progressToken || '',
            progressStages: d.progressStages || defaultStages(),
            progressRemarks: d.progressRemarks || d.remarks || '',
            progressUpdatedAt: d.progressUpdatedAt || '',
            progressHistory: d.progressHistory || [],
            assemblyConstituency: d.assemblyConstituency || '',
            mandal: d.mandal || '',
            village: d.village || '',
            division: d.division || '',
            dateOfVisit: d.dateOfVisit || '',
            referenceName: d.referenceName || '',
            referenceNumber: d.referenceNumber || '',
            categories: d.categories || [],
            others: d.others || '',
            actionTaken: d.actionTaken || '',
            actionToBeTaken: d.actionToBeTaken || '',
            assignedOfficer: d.assignedOfficer || '',
            resolutionStatus: d.resolutionStatus || '',
            deadline: d.deadline || '',
            visitDate: d.visitDate || '',
            visitTime: d.visitTime || '',
            leadPhone: d.leadPhone || '',
          }));
        }
      } catch (err) {
        this.logger.warn(
          `Could not load ${section} records from database: ${err}`,
        );
      }
    }

    // Filter closed/rejected for grievances by default
    if (section === 'grievances') {
      all = all.filter((g) => g.status !== 'Closed' && g.status !== 'Rejected');
    }

    // Role-based Department Scope Filtering
    if (auth.role === 'superadmin' || !auth.department) {
      return all;
    }

    const deptLower = auth.department.toLowerCase().trim();
    return all.filter((r) => {
      const assignedDept = (
        r.followUpDepartment ||
        r.department ||
        ''
      ).toLowerCase();
      if (!assignedDept) {
        const desk = assignDesk(`${r.title} ${r.detail} ${r.place}`);
        return desk.department.toLowerCase().includes(deptLower);
      }
      return assignedDept.includes(deptLower);
    });
  }

  private async getRecordById(
    section: 'grievances' | 'projects',
    id: string,
    deps: { records?: unknown },
  ): Promise<WorkspaceRecord | null> {
    if (deps.records && Array.isArray(deps.records)) {
      const match = (deps.records as WorkspaceRecord[]).find(
        (r) => r.id === id,
      );
      if (match) return match;
    }
    if (this.workspace) {
      try {
        return await this.workspace.get(id);
      } catch {
        // Continue fallback
      }
    }
    return null;
  }

  private filterRecords(
    items: WorkspaceRecord[],
    query: string,
  ): WorkspaceRecord[] {
    const qLower = query.toLowerCase().trim();
    const qDigits = digits(query);

    return items.filter((r) => {
      const sr = (r.srNumber || '').toLowerCase();
      const id = (r.id || '').toLowerCase();
      const title = (r.title || r.fullName || '').toLowerCase();
      const place = (r.place || r.village || '').toLowerCase();
      const dept = (r.followUpDepartment || r.department || '').toLowerCase();

      if (
        sr.includes(qLower) ||
        id.includes(qLower) ||
        title.includes(qLower) ||
        place.includes(qLower) ||
        dept.includes(qLower)
      ) {
        return true;
      }
      if (
        qDigits &&
        qDigits.length >= 2 &&
        digits(r.srNumber || r.id).includes(qDigits)
      ) {
        return true;
      }
      return false;
    });
  }

  private getSession(sender: string): DeptSession | null {
    const s = this.sessions.get(digits(sender));
    if (!s) return null;
    if (Date.now() - s.updatedAt > SESSION_TTL_MS) {
      this.sessions.delete(digits(sender));
      return null;
    }
    return s;
  }

  private getOrCreateSession(sender: string): DeptSession {
    let s = this.getSession(sender);
    if (!s) {
      s = {
        phone: digits(sender),
        step: 'IDLE',
        module: 'grievances',
        action: 'view',
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
    const rawResp = event.interactive_response;
    if (!rawResp || typeof rawResp !== 'object') return '';
    const list = rawResp.list_reply as { id?: string } | undefined;
    const btn = rawResp.button_reply as { id?: string } | undefined;
    return String(list?.id || btn?.id || '').trim();
  }
}

function isGreetingOnly(text: string): boolean {
  const norm = text.toLowerCase().replace(/[^a-z]/g, '');
  return ['hi', 'hello', 'hey', 'start', 'help', 'menu'].includes(norm);
}
