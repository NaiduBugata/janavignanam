import { randomBytes } from 'node:crypto';
import { Injectable, Logger, Optional } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { ArticleRepository } from '../database/repositories/article.repository';
import { hasAssemblySegment } from '../pipeline/native/constituency';
import { FOLLOW_UP_SENT } from '../visits/visit-followup';
import { VisitFollowupService } from '../visits/visit-followup.service';
import { formatVisitTime } from '../visits/visits-import';
import {
  parseWebhookPayload,
  type WhatsAppEvent,
} from '../whatsapp/whatsapp.parser';
import { todayInIndia } from '../birthdays/birthdays';
import {
  isMpPhone,
  isPersonPhone,
  isSuperAdminPhone,
  personName,
  phoneForName,
  replyRecipients,
  staffDirectoryLoaded,
} from '../whatsapp/whatsapp.audience';
import { notifySuperAdminText } from '../whatsapp/whatsapp.notify';
import {
  normalizePhone,
  sendReplyList,
  sendTextMessage,
  type MenuRow,
} from '../whatsapp/whatsapp.send';
import {
  DEMO_PROJECTS,
  isDemoDataEnabled,
  isDemoDoc,
} from '../admin/demo-data';
import {
  FOLLOWUP_PHONE_LABEL,
  findFollowupContact,
  followupBucket,
  followupContactsIn,
  followupMessage,
  recordFollowup,
  type FollowupBucket,
} from './followup-contacts';
import {
  assignDesk,
  classifyGrievance,
  departmentOrder,
  grievanceReceipt,
  leaderNotice,
  leaderUpdate,
  messageLanguage,
  MOCK_GRIEVANCES,
  priorityLabel,
  type GrievanceLanguage,
  type GrievancePriority,
} from './grievance-priority';
import {
  defaultStages,
  type ProgressStage,
} from '../workspace/progress-report';
import { WorkspaceService } from '../workspace/workspace.service';
import { GrievanceProgressService } from '../whatsapp/grievance-progress.service';
import { DepartmentOperationsService } from '../whatsapp/department-operations.service';
import { discoverGroqApiKeys } from '../ai/groq-keys';
import { newestFirst, toBrief, type NewsBrief } from './news-context';

const RECORDS = 'jv_records';
const TOP = 5;
const LIST_BODY_LIMIT = 1024;
const TEXT_LIMIT = 4096;
const MP_TOP = 6;
const GRIEVANCE_OPTIONS = 8;

const MOCK_CAMPAIGNS: Array<{ title: string; detail: string; status: string }> =
  [
    {
      title: 'Door to door',
      detail: 'Narasaraopet ward visits this week.',
      status: 'Open',
    },
    {
      title: 'Youth meeting',
      detail: 'Chilakaluripet youth meeting on Sunday.',
      status: 'Open',
    },
    {
      title: 'Rythu bharosa',
      detail: 'Sattenapalle camp for farmers.',
      status: 'In progress',
    },
    { title: 'Health camp', detail: 'Vinukonda medical camp.', status: 'Open' },
  ];

const MOCK_CONSTITUENCY: Array<{
  title: string;
  detail: string;
  status: string;
}> = [
  {
    title: 'Narasaraopet Lok Sabha',
    detail:
      'Palnadu district, Andhra Pradesh. MP: Sri Lavu Sri Krishna Devarayalu. Assembly: Narasaraopet, Chilakaluripet, Sattenapalle, Vinukonda, Gurazala, Macherla, Pedakurapadu.',
    status: 'Open',
  },
  {
    title: 'Narasaraopet',
    detail: 'Assembly segment of Narasaraopet constituency.',
    status: 'Open',
  },
  {
    title: 'Chilakaluripet',
    detail: 'Assembly segment of Narasaraopet constituency.',
    status: 'Open',
  },
  {
    title: 'Sattenapalle',
    detail: 'Assembly segment of Narasaraopet constituency.',
    status: 'Open',
  },
  {
    title: 'Vinukonda',
    detail: 'Assembly segment of Narasaraopet constituency.',
    status: 'Open',
  },
  {
    title: 'Gurazala',
    detail: 'Assembly segment of Narasaraopet constituency.',
    status: 'Open',
  },
  {
    title: 'Macherla',
    detail: 'Assembly segment of Narasaraopet constituency.',
    status: 'Open',
  },
  {
    title: 'Pedakurapadu',
    detail: 'Assembly segment of Narasaraopet constituency.',
    status: 'Open',
  },
];

const MOCK_ANALYTICS = [
  '*Narasaraopet constituency*\n48 articles counted this week',
  '*Sentiment*\nPositive 19 · Negative 16 · Neutral 13',
  '*Issues*\nRoads 11 · Water 8 · Health 6 · Farming 5',
  '*Places*\nNarasaraopet 18 · Chilakaluripet 9 · Vinukonda 7 · Sattenapalle 6',
];

/** Super admin sees the MP list and the admin list. */
function fullMenu(sender: string): boolean {
  return isMpPhone(sender) || isSuperAdminPhone(sender);
}
const NEWS_CACHE_MS = 60_000;
const CONVERSATION_GAP_MS = 4 * 60 * 60 * 1000;
const DEFAULT_ADDRESSEE = 'Sri. Lavu Sri Krishna Devarayalu Sir';
const MENU_PROMPT = 'Choose a section.';
export const MAIN_MENU_TEXT = 'Choose a section.';
export const GRIEVANCE_RECEIPT = grievanceReceipt('en');

export const FOLLOW_UP_ROW: MenuRow = { id: 'follow_up', title: 'Follow up' };
export const MAIN_BUTTONS: MenuRow[] = [
  { id: 'news', title: 'News' },
  { id: 'visits', title: 'Visits' },
  { id: 'followups', title: 'Followup' },
  { id: 'grievances', title: 'Grievances' },
  { id: 'projects', title: 'Projects & reports' },
  { id: 'constituency', title: 'Constituency' },
  { id: 'campaigns', title: 'Campaigns' },
  { id: 'analytics', title: 'Analytics' },
];
export const VISIT_BUTTONS: MenuRow[] = [FOLLOW_UP_ROW, ...MAIN_BUTTONS];

const CHOICE_BUTTONS: MenuRow[] = [
  ...MAIN_BUTTONS,
  FOLLOW_UP_ROW,
  { id: 'fu:recent', title: 'Recent Follow-ups' },
  { id: 'fu:frequent', title: 'Frequently Followed Up' },
  { id: 'fu:pending', title: 'Not followed up' },
  { id: 'menu', title: 'Menu' },
  { id: 'home', title: 'Main menu' },
];

export type MenuId =
  | 'grievances'
  | 'projects'
  | 'news'
  | 'constituency'
  | 'campaigns'
  | 'analytics'
  | 'visits'
  | 'followups';
export type MenuChoice =
  | MenuId
  | 'home'
  | 'menu'
  | 'follow_up'
  | 'fu:recent'
  | 'fu:frequent'
  | 'fu:pending';

const RECORD_SECTION: Partial<
  Record<MenuId, 'grievances' | 'projects' | 'people' | 'campaigns' | 'visits'>
> = {
  grievances: 'grievances',
  projects: 'projects',
  constituency: 'people',
  campaigns: 'campaigns',
  visits: 'visits',
};

const SECTION_TITLE: Record<MenuId, string> = {
  grievances: 'Grievances',
  projects: 'Projects & reports',
  news: 'News',
  constituency: 'Constituency',
  campaigns: 'Campaigns',
  analytics: 'Analytics',
  visits: 'Visits',
  followups: 'Followup',
};

const TEXT_ALIASES: Record<string, MenuChoice> = {
  grievance: 'grievances',
  grievances: 'grievances',
  project: 'projects',
  projects: 'projects',
  'projects & reports': 'projects',
  'projects and reports': 'projects',
  report: 'projects',
  reports: 'projects',
  news: 'news',
  'latest news': 'news',
  update: 'news',
  updates: 'news',
  'latest updates': 'news',
  visit: 'visits',
  visits: 'visits',
  'main menu': 'home',
  menu: 'home',
  'follow up': 'follow_up',
  followup: 'followups',
  followups: 'followups',
  'recent follow ups': 'fu:recent',
  'recent follow-ups': 'fu:recent',
  'frequently followed up': 'fu:frequent',
  'not followed up': 'fu:pending',
  constituency: 'constituency',
  people: 'constituency',
  more: 'home',
  campaign: 'campaigns',
  campaigns: 'campaigns',
  analytic: 'analytics',
  analytics: 'analytics',
};

export interface MenuRecord {
  title: string;
  detail: string;
  status: string;
  date: string;
  id?: string;
  priority?: GrievancePriority;
  issue?: string;
  place?: string;
  department?: string;
  leader?: string;
  language?: GrievanceLanguage;
  createdBy?: string;
  reporterPhone?: string;
  source?: string;
  followUpDepartment?: string;
  progressToken?: string;
  progressStages?: ProgressStage[];
  progressRemarks?: string;
  progressUpdatedAt?: string;
  section?: string;
}

export interface ChatbotDeps {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  news?: NewsBrief[];
  records?: Partial<
    Record<
      'grievances' | 'projects' | 'people' | 'campaigns' | 'visits',
      MenuRecord[]
    >
  >;
  now?: () => Date;
}

@Injectable()
export class ChatbotService {
  private readonly logger = new Logger(ChatbotService.name);
  private readonly answered = new Set<string>();
  private readonly inflight = new Set<string>();
  private readonly queues = new Map<string, Promise<void>>();
  private readonly lastReplyAt = new Map<string, number>();
  /** Visit messages go out after the menu reply, so a Follow up tap cannot freeze this chat. */
  private followUps: Promise<void> = Promise.resolve();
  private newsCache: { at: number; briefs: NewsBrief[] } | null = null;
  private readonly gpmService: GrievanceProgressService;
  private readonly deptOpsService: DepartmentOperationsService;

  constructor(
    @Optional() private readonly articles?: ArticleRepository,
    @Optional() private readonly db?: DatabaseService,
    @Optional() private readonly followUp?: VisitFollowupService,
    @Optional() private readonly workspace?: WorkspaceService,
    @Optional() private readonly gpm?: GrievanceProgressService,
    @Optional() private readonly deptOps?: DepartmentOperationsService,
  ) {
    this.gpmService = gpm || new GrievanceProgressService(workspace, db);
    this.deptOpsService =
      deptOps || new DepartmentOperationsService(workspace, db);
  }

  /** Starts a reply after the webhook has already been acknowledged. Never throws. */
  consider(payload: unknown, deps: ChatbotDeps = {}): void {
    void this.handle(payload, deps).catch((err) => {
      this.logger.warn(
        err instanceof Error ? err.message : 'Chatbot reply failed.',
      );
    });
  }

  async handle(payload: unknown, deps: ChatbotDeps = {}): Promise<void> {
    const env = deps.env || process.env;
    if (!chatbotEnabled(env)) return;
    const allowed = allowlist(env);
    let events: WhatsAppEvent[] = [];
    try {
      if (payload && typeof payload === 'object') {
        events = parseWebhookPayload(payload as Record<string, unknown>);
      }
    } catch {
      return;
    }
    const messages = events.filter(
      (event) =>
        event.event_category === 'message' &&
        event.sender_wa_id &&
        event.message_id,
    );
    const filing = messages.some((event) =>
      isPersonPhone(event.sender_wa_id || ''),
    );
    const hasDept = messages.some((event) =>
      this.deptOpsService.isDepartmentUser(event.sender_wa_id || '', env),
    );
    if (!allowed.length && !filing && !hasDept) {
      this.logger.warn(
        staffDirectoryLoaded()
          ? 'Chatbot replies are off because no admin numbers are set.'
          : 'Chatbot replies are off because WHATSAPP_RECIPIENTS is empty.',
      );
      return;
    }
    for (const event of messages) {
      const sender = event.sender_wa_id || '';
      if (isPersonPhone(sender)) {
        await this.enqueue(sender, () => this.fileGrievance(event, env, deps));
        continue;
      }
      const isDept = this.deptOpsService.isDepartmentUser(sender, env);
      if (!allowed.includes(digits(sender)) && !isDept) {
        this.logger.warn(`Ignored chatbot message from ${maskPhone(sender)}.`);
        continue;
      }
      await this.enqueue(sender, () => this.replyTo(event, env, deps));
    }
  }

  /** A person files a grievance on the website. The text is not sent on to an admin. */
  private async fileGrievance(
    event: WhatsAppEvent,
    env: NodeJS.ProcessEnv,
    deps: ChatbotDeps,
  ): Promise<void> {
    const messageId = event.message_id || '';
    if (
      !messageId ||
      this.answered.has(messageId) ||
      this.inflight.has(messageId)
    )
      return;
    this.inflight.add(messageId);
    const sender = event.sender_wa_id || '';
    const fetchImpl = replyFetch(deps.fetchImpl || fetch);
    try {
      const saved = await this.saveGrievance(event);
      if (saved !== 'saved') {
        this.answered.add(messageId);
        return;
      }
      await sendTextMessage(
        sender,
        grievanceReceipt(messageLanguage(grievanceDetail(event))),
        fetchImpl,
        env,
      );
      const name = personName(sender) || 'Person';
      const detail = grievanceDetail(event);
      const { priority } = classifyGrievance(detail);
      await notifySuperAdminText(
        `Grievance from ${name}. ${priorityLabel(priority)}. ${detail}`,
        fetchImpl,
        env,
      );
      this.answered.add(messageId);
      this.logger.log(`Grievance saved from ${maskPhone(sender)}.`);
    } catch (err) {
      this.logger.warn(
        `Grievance was not saved from ${maskPhone(sender)}: ${err instanceof Error ? err.message : 'save failed'}`,
      );
    } finally {
      this.inflight.delete(messageId);
    }
  }

  private async saveGrievance(
    event: WhatsAppEvent,
  ): Promise<'saved' | 'duplicate' | 'unavailable'> {
    if (!this.db) return 'unavailable';
    const ok = await this.db.ensureConnected();
    if (!ok) return 'unavailable';
    const messageId = event.message_id || '';
    const existing = await this.db
      .collection(RECORDS)
      .findOne({ section: 'grievances', sourceMessageId: messageId });
    if (existing) return 'duplicate';
    const name = personName(event.sender_wa_id || '') || 'Person';
    const detail = grievanceDetail(event);
    const { priority } = classifyGrievance(detail);
    const desk = assignDesk(detail);
    await this.db.collection(RECORDS).insertOne({
      section: 'grievances',
      title: detail.slice(0, 80),
      detail: detail.slice(0, 2000),
      place: desk.place,
      department: desk.department,
      leader: desk.leader,
      language: messageLanguage(detail),
      status: 'Open',
      priority,
      createdAt: new Date().toISOString(),
      createdBy: name.slice(0, 80),
      reporterPhone: digitsOf(event.sender_wa_id || ''),
      sourceMessageId: messageId,
    });
    return 'saved';
  }

  private async replyTo(
    event: WhatsAppEvent,
    env: NodeJS.ProcessEnv,
    deps: ChatbotDeps,
  ): Promise<void> {
    const messageId = event.message_id || '';
    if (
      !messageId ||
      this.answered.has(messageId) ||
      this.inflight.has(messageId)
    )
      return;
    this.inflight.add(messageId);
    const sender = event.sender_wa_id || '';
    const now = (deps.now || (() => new Date()))();
    const last = this.lastReplyAt.get(sender);
    const opening =
      last === undefined || now.getTime() - last > CONVERSATION_GAP_MS;
    const fetchImpl = replyFetch(deps.fetchImpl || fetch);
    try {
      if (this.deptOpsService.isDepartmentEvent(event, sender, env)) {
        await this.deptOpsService.handleEvent(
          event,
          sender,
          fetchImpl,
          env,
          deps,
        );
        this.answered.add(messageId);
        this.lastReplyAt.set(sender, now.getTime());
        this.logger.log(
          `Department operations replied to ${maskPhone(sender)}.`,
        );
        return;
      }

      const followId = grievanceFollow(event);
      const picked = grievancePick(event);
      const followupId = followupContactId(event);
      const choice =
        followId || picked || followupId ? null : menuChoice(event);
      if (followId) {
        await this.followGrievance(sender, followId, fetchImpl, env, deps);
      } else if (followupId) {
        await this.sendContactFollowup(sender, followupId, fetchImpl, env);
      } else if (choice === 'followups') {
        await this.sendFollowupMenu(sender, fetchImpl, env);
      } else if (
        choice === 'fu:recent' ||
        choice === 'fu:frequent' ||
        choice === 'fu:pending'
      ) {
        await this.sendFollowupBucket(
          sender,
          choice.slice(3) as FollowupBucket,
          fetchImpl,
          env,
        );
      } else if (picked || choice === 'grievances') {
        await this.sendMpGrievances(sender, picked, fetchImpl, env, deps);
      } else if (choice === 'follow_up') {
        await this.replyFollowUp(sender, fetchImpl, env, deps);
      } else if (choice === 'home' || choice === 'menu') {
        if (
          this.deptOpsService.isDepartmentUser(sender, env) &&
          !isMpPhone(sender)
        ) {
          await this.deptOpsService.handleEvent(
            event,
            sender,
            fetchImpl,
            env,
            deps,
          );
        } else {
          await this.sendMenu(sender, MAIN_MENU_TEXT, fetchImpl, env);
        }
      } else if (choice) {
        const limit = fullMenu(sender) ? MP_TOP : TOP;
        const body = await this.renderSection(choice, deps, limit, now);
        const rows = choice === 'visits' ? VISIT_BUTTONS : MAIN_BUTTONS;
        await this.deliverSection(sender, body, rows, fetchImpl, env);
      } else {
        const text = (event.message_text || '').trim();
        if (
          !text ||
          isGreetingOnly(text) ||
          (!this.db && !this.workspace && !deps.records)
        ) {
          if (
            this.deptOpsService.isDepartmentUser(sender, env) &&
            !isMpPhone(sender)
          ) {
            await this.deptOpsService.handleEvent(
              event,
              sender,
              fetchImpl,
              env,
              deps,
            );
          } else {
            const lead = opening
              ? `${openingLine(now, env)}\n\n${MENU_PROMPT}`
              : MAIN_MENU_TEXT;
            await this.sendMenu(sender, lead, fetchImpl, env);
          }
        } else {
          await this.answerConstituencyQuery(
            sender,
            text,
            fetchImpl,
            env,
            deps,
          );
        }
      }
      this.answered.add(messageId);
      this.lastReplyAt.set(sender, now.getTime());
      this.logger.log(`Chatbot replied to ${maskPhone(sender)}.`);
    } catch (err) {
      this.logger.warn(
        `Chatbot reply was not delivered to ${maskPhone(sender)}: ${err instanceof Error ? err.message : 'send failed'}`,
      );
    } finally {
      this.inflight.delete(messageId);
    }
  }

  private async replyFollowUp(
    sender: string,
    fetchImpl: typeof fetch,
    env: NodeJS.ProcessEnv,
    deps: ChatbotDeps,
  ): Promise<void> {
    if (this.followUp && typeof this.followUp.readyToSend === 'function') {
      let ready = false;
      try {
        ready = await this.followUp.readyToSend();
      } catch (err) {
        this.logger.warn(
          `Visit follow-up failed: ${err instanceof Error ? err.message : 'send failed'}`,
        );
      }
      if (!ready) {
        const body = await this.renderSection(
          'visits',
          deps,
          fullMenu(sender) ? MP_TOP : TOP,
        );
        await this.sendList(sender, body, VISIT_BUTTONS, fetchImpl, env);
        return;
      }
      await this.sendMenu(sender, FOLLOW_UP_SENT, fetchImpl, env);
      const followUp = this.followUp;
      this.followUps = this.followUps.then(() =>
        followUp.sendAll(fetchImpl).then(
          (result) => {
            if (!result.sent)
              this.logger.warn('Visit follow-up was not accepted.');
          },
          (err) => {
            this.logger.warn(
              `Visit follow-up failed: ${err instanceof Error ? err.message : 'send failed'}`,
            );
          },
        ),
      );
      return;
    }
    let sent = 0;
    try {
      if (this.followUp && this.followUp.sendAll)
        sent = (await this.followUp.sendAll(fetchImpl)).sent;
    } catch (err) {
      this.logger.warn(
        `Visit follow-up failed: ${err instanceof Error ? err.message : 'send failed'}`,
      );
    }
    if (sent > 0) {
      await this.sendMenu(sender, FOLLOW_UP_SENT, fetchImpl, env);
      return;
    }
    const body = await this.renderSection(
      'visits',
      deps,
      fullMenu(sender) ? MP_TOP : TOP,
    );
    await this.sendList(sender, body, VISIT_BUTTONS, fetchImpl, env);
  }

  private async sendFollowupMenu(
    sender: string,
    fetchImpl: typeof fetch,
    env: NodeJS.ProcessEnv,
  ): Promise<void> {
    await this.sendList(
      sender,
      '*Followup*\nChoose a list.',
      [
        { id: 'fu:recent', title: 'Recent Follow-ups' },
        { id: 'fu:frequent', title: 'Frequently Followed Up' },
        { id: 'fu:pending', title: 'Not followed up' },
        { id: 'home', title: 'Main menu' },
      ],
      fetchImpl,
      env,
    );
  }

  private async sendFollowupBucket(
    sender: string,
    bucket: FollowupBucket,
    fetchImpl: typeof fetch,
    env: NodeJS.ProcessEnv,
  ): Promise<void> {
    const contacts = followupContactsIn(bucket);
    const title = FOLLOWUP_BUCKET_TITLE[bucket];
    if (!contacts.length) {
      await this.sendList(
        sender,
        `*${title}*\nNothing saved yet.`,
        [
          { id: 'followups', title: 'Followup' },
          { id: 'home', title: 'Main menu' },
        ],
        fetchImpl,
        env,
      );
      return;
    }
    const rows = contacts.map((contact) => ({
      id: `fu:c:${contact.id}`,
      title: clip(contact.name, 24) || contact.name,
      description: FOLLOWUP_PHONE_LABEL,
    }));
    const pages = chunkRows(rows, 10);
    for (const [index, page] of pages.entries()) {
      const last = index === pages.length - 1;
      const list =
        last && page.length < 10
          ? [...page, { id: 'home', title: 'Main menu' }]
          : page;
      const range =
        pages.length === 1
          ? `${contacts.length} contacts`
          : `${index * 10 + 1}–${Math.min((index + 1) * 10, contacts.length)} of ${contacts.length}`;
      await this.sendList(
        sender,
        `*${title}*\n${range}. Tap a name to send a follow-up.`,
        list,
        fetchImpl,
        env,
      );
    }
  }

  private async sendContactFollowup(
    sender: string,
    id: string,
    fetchImpl: typeof fetch,
    env: NodeJS.ProcessEnv,
  ): Promise<void> {
    const contact = findFollowupContact(id);
    if (!contact) {
      await this.sendFollowupMenu(sender, fetchImpl, env);
      return;
    }
    const sent = await this.sendNotice(
      contact.phone,
      followupMessage(contact.name),
      fetchImpl,
      env,
    );
    if (!sent) {
      await sendTextMessage(
        sender,
        `Follow-up was not sent to ${contact.name}.`,
        fetchImpl,
        env,
      );
      await this.sendFollowupMenu(sender, fetchImpl, env);
      return;
    }
    const updated = recordFollowup(id);
    const bucket = updated ? followupBucket(updated) : 'recent';
    const moved =
      bucket === 'frequent'
        ? 'Moved to Frequently Followed Up.'
        : 'Moved to Recent Follow-ups.';
    await sendTextMessage(
      sender,
      `Follow-up sent to ${contact.name} (${FOLLOWUP_PHONE_LABEL}). ${moved}`,
      fetchImpl,
      env,
    );
    await this.sendFollowupMenu(sender, fetchImpl, env);
  }

  /** Grievances as list rows, high priority first. Choosing one opens that issue. */
  private async sendMpGrievances(
    sender: string,
    pickedId: string | null,
    fetchImpl: typeof fetch,
    env: NodeJS.ProcessEnv,
    deps: ChatbotDeps,
  ): Promise<void> {
    const items = (
      fullMenu(sender)
        ? await this.mpGrievances(deps)
        : await this.sectionRecords('grievances', deps, TOP)
    ).filter(isOpenGrievance);
    const picked = pickedId
      ? items.find((item) => item.id === pickedId || item.title === pickedId)
      : undefined;
    if (picked) {
      await this.sendList(
        sender,
        grievanceView(picked),
        [
          { id: `gf:${picked.id || picked.title}`, title: 'Follow up' },
          ...MAIN_BUTTONS,
        ],
        fetchImpl,
        env,
      );
      return;
    }
    const body = items.length
      ? '*Grievances*\n\nHigh priority first. Choose one.'
      : '*Grievances*\nNothing saved yet.';
    const rows: MenuRow[] = items
      .slice(0, fullMenu(sender) ? GRIEVANCE_OPTIONS : TOP)
      .map((item) => ({
        id: `g:${item.id || item.title}`,
        title: clip(item.title, 24) || 'Grievance',
        description: priorityLabel(item.priority || 'normal'),
      }));
    if (rows.length < 10) rows.push({ id: 'home', title: 'Main menu' });
    if (!rows.length) {
      await this.sendMenu(sender, body, fetchImpl, env);
      return;
    }
    await this.sendList(sender, body, rows, fetchImpl, env);
  }

  /** Department order to Akshay, a notice to the leader, and the progress note to the person who raised it. */
  private async followGrievance(
    sender: string,
    pickedId: string,
    fetchImpl: typeof fetch,
    env: NodeJS.ProcessEnv,
    deps: ChatbotDeps,
  ): Promise<void> {
    if (this.db && !deps.records && isDemoDataEnabled()) {
      await this.ensureMockGrievances();
      await this.stampMockReporters();
    }
    const loaded = await this.sectionRecords('grievances', deps, 40);
    const picked = loaded.find(
      (item) => item.id === pickedId || item.title === pickedId,
    );
    if (!picked) {
      await this.sendMpGrievances(sender, null, fetchImpl, env, deps);
      return;
    }
    const issue = issueOf(picked);
    const desk = assignDesk(issue);
    const departmentPhone = phoneForName('akshay');
    if (!departmentPhone) {
      await sendTextMessage(
        sender,
        'Follow up was not sent. Akshay is not in the contact list.',
        fetchImpl,
        env,
      );
      return;
    }
    const leaderPhone = phoneForName(desk.leader) || departmentPhone;
    const raiser = raiserPhone(picked);
    const language = picked.language || messageLanguage(issue);
    const progress = this.progressToken(picked, deps);
    const departmentSent = await this.sendNotice(
      departmentPhone,
      departmentOrder(issue, desk, progressPageUrl(env, progress.token)),
      fetchImpl,
      env,
    );
    const leaderSent = await this.sendNotice(
      leaderPhone,
      leaderNotice(issue, desk),
      fetchImpl,
      env,
    );
    const raiserSent = raiser
      ? await this.sendNotice(raiser, leaderUpdate(language), fetchImpl, env)
      : false;
    if (!departmentSent && !leaderSent) {
      await sendTextMessage(
        sender,
        'Follow up was not sent to the department or the leader.',
        fetchImpl,
        env,
      );
      return;
    }
    await this.markGrievanceReviewed(picked, desk.department, deps, progress);
    const lead =
      raiser && !raiserSent
        ? 'Follow up sent to the department and the leader. The person who raised it is not in the contact list.'
        : 'Follow up sent.';
    await this.sendMenu(sender, lead, fetchImpl, env);
    this.logger.log(
      `Grievance follow up sent to department ${maskPhone(departmentPhone)} and leader ${maskPhone(leaderPhone)}.`,
    );
  }

  private async sendNotice(
    phone: string,
    body: string,
    fetchImpl: typeof fetch,
    env: NodeJS.ProcessEnv,
  ): Promise<boolean> {
    try {
      await sendTextMessage(phone, body, fetchImpl, env);
      return true;
    } catch (err) {
      this.logger.warn(
        `Grievance notice was not sent to ${maskPhone(phone)}: ${err instanceof Error ? err.message : 'send failed'}`,
      );
      return false;
    }
  }

  private async mpGrievances(deps: ChatbotDeps): Promise<MenuRecord[]> {
    if (this.db && !deps.records && isDemoDataEnabled())
      await this.ensureMockGrievances();
    const loaded = await this.sectionRecords('grievances', deps, 40);
    return byPriority(loaded.filter(isOpenGrievance)).slice(
      0,
      GRIEVANCE_OPTIONS,
    );
  }

  /** After a follow-up, the grievance leaves the WhatsApp list and shows as reviewed on the website. */
  private progressToken(
    picked: MenuRecord,
    deps: ChatbotDeps,
  ): { token: string; fresh: boolean } {
    const source = (deps.records?.grievances || []).find((row) =>
      sameGrievance(row, picked),
    );
    const existing = source?.progressToken || picked.progressToken || '';
    if (existing) return { token: existing, fresh: false };
    return { token: randomBytes(9).toString('hex'), fresh: true };
  }

  private async markGrievanceReviewed(
    picked: MenuRecord,
    department: string,
    deps: ChatbotDeps,
    progress?: { token: string; fresh: boolean },
  ): Promise<void> {
    const patch = {
      status: 'Reviewed',
      followUpDepartment: department,
      followUpAt: new Date().toISOString(),
      ...(progress ? { progressToken: progress.token } : {}),
      ...(progress?.fresh
        ? {
            progressStages: defaultStages(),
            progressUpdatedAt: new Date().toISOString(),
          }
        : {}),
    };
    for (const row of deps.records?.grievances || []) {
      if (sameGrievance(row, picked)) Object.assign(row, patch);
    }
    if (!this.db || deps.records) return;
    try {
      const ok = await this.db.ensureConnected();
      if (!ok) return;
      const coll = this.db.collection(RECORDS);
      const id = picked.id || '';
      if (/^[a-f0-9]{24}$/i.test(id)) {
        const saved = await coll.updateOne(
          { section: 'grievances', _id: id },
          { $set: patch },
        );
        if (saved.matchedCount) return;
      }
      if (id) {
        const saved = await coll.updateOne(
          { section: 'grievances', sourceMessageId: id },
          { $set: patch },
        );
        if (saved.matchedCount) return;
      }
      if (picked.title)
        await coll.updateOne(
          { section: 'grievances', title: picked.title, status: 'Open' },
          { $set: patch },
        );
    } catch (err) {
      this.logger.warn(
        `Grievance was not marked reviewed: ${err instanceof Error ? err.message : 'database error'}`,
      );
    }
  }

  private async ensureMockCampaigns(): Promise<void> {
    if (!this.db || !isDemoDataEnabled()) return;
    try {
      const ok = await this.db.ensureConnected();
      if (!ok) return;
      const existing = await this.db
        .collection(RECORDS)
        .find({ section: 'campaigns' })
        .sort({ createdAt: -1 })
        .limit(1)
        .toArray();
      if (existing.length) return;
      const createdAt = new Date().toISOString();
      for (const item of MOCK_CAMPAIGNS) {
        await this.db.collection(RECORDS).insertOne({
          section: 'campaigns',
          title: item.title,
          detail: item.detail,
          status: item.status,
          createdAt,
          createdBy: 'Sample',
          source: 'mock',
        });
      }
    } catch (err) {
      this.logger.warn(
        `Chatbot could not store sample campaigns: ${err instanceof Error ? err.message : 'database error'}`,
      );
    }
  }

  private async ensureSamples(
    section: 'projects' | 'people',
    items: Array<{ title: string; detail: string; status: string }>,
  ): Promise<void> {
    if (!this.db || !isDemoDataEnabled()) return;
    try {
      const ok = await this.db.ensureConnected();
      if (!ok) return;
      const existing = await this.db
        .collection(RECORDS)
        .find({ section })
        .sort({ createdAt: -1 })
        .limit(200)
        .toArray();
      const titles = new Set(
        existing.map((row) =>
          String(row.title || '')
            .trim()
            .toLowerCase(),
        ),
      );
      const missing = items.filter(
        (item) => !titles.has(item.title.trim().toLowerCase()),
      );
      if (!missing.length) return;
      const createdAt = new Date().toISOString();
      for (const item of missing) {
        await this.db.collection(RECORDS).insertOne({
          section,
          title: item.title,
          detail: item.detail,
          status: item.status,
          createdAt,
          createdBy: 'Sample',
          source: 'mock',
        });
      }
    } catch (err) {
      this.logger.warn(
        `Chatbot could not store sample ${section}: ${err instanceof Error ? err.message : 'database error'}`,
      );
    }
  }

  private async stampMockReporters(): Promise<void> {
    if (!this.db || !isDemoDataEnabled()) return;
    try {
      const ok = await this.db.ensureConnected();
      if (!ok) return;
      const rows = await this.db
        .collection(RECORDS)
        .find({ section: 'grievances', source: 'mock' })
        .toArray();
      for (const row of rows) {
        const title = text(row.title);
        const item = MOCK_GRIEVANCES.find(
          (sample) => sample.title.toLowerCase() === title.toLowerCase(),
        );
        if (!item) continue;
        const reporterPhone = phoneForName(item.reporter);
        const language =
          row.language === 'te' || row.language === 'en'
            ? row.language
            : messageLanguage(text(row.detail) || title);
        if (
          row.createdBy === item.reporter &&
          row.language === language &&
          (!reporterPhone || row.reporterPhone === reporterPhone)
        )
          continue;
        await this.db.collection(RECORDS).updateOne(
          { _id: row._id },
          {
            $set: {
              createdBy: item.reporter,
              language,
              ...(reporterPhone ? { reporterPhone } : {}),
            },
          },
        );
      }
    } catch (err) {
      this.logger.warn(
        `Chatbot could not attach sample grievance contacts: ${err instanceof Error ? err.message : 'database error'}`,
      );
    }
  }

  private async ensureMockGrievances(): Promise<void> {
    if (!this.db || !isDemoDataEnabled()) return;
    try {
      const ok = await this.db.ensureConnected();
      if (!ok) return;
      const existing = await this.db
        .collection(RECORDS)
        .find({ section: 'grievances' })
        .sort({ createdAt: -1 })
        .limit(1)
        .toArray();
      if (existing.length) return;
      const createdAt = new Date().toISOString();
      for (const item of MOCK_GRIEVANCES) {
        const reporterPhone = phoneForName(item.reporter);
        await this.db.collection(RECORDS).insertOne({
          section: 'grievances',
          title: item.title,
          detail: `${priorityLabel(item.priority)} — ${item.detail}`,
          status: 'Open',
          priority: item.priority,
          language: messageLanguage(item.detail),
          createdAt,
          createdBy: item.reporter,
          ...(reporterPhone ? { reporterPhone } : {}),
          source: 'mock',
        });
      }
    } catch (err) {
      this.logger.warn(
        `Chatbot could not store sample grievances: ${err instanceof Error ? err.message : 'database error'}`,
      );
    }
  }

  private async sendMenu(
    sender: string,
    lead: string,
    fetchImpl: typeof fetch,
    env: NodeJS.ProcessEnv,
  ): Promise<void> {
    await this.sendList(sender, lead, MAIN_BUTTONS, fetchImpl, env);
  }

  /** A short answer stays in the menu message. A long news answer is sent in full, then the menu. */
  private async deliverSection(
    sender: string,
    lead: string,
    rows: MenuRow[],
    fetchImpl: typeof fetch,
    env: NodeJS.ProcessEnv,
  ): Promise<void> {
    if (lead.length <= LIST_BODY_LIMIT) {
      await this.sendList(sender, lead, rows, fetchImpl, env);
      return;
    }
    for (const part of completeParts(lead, TEXT_LIMIT)) {
      await sendTextMessage(sender, part, fetchImpl, env);
    }
    await this.sendList(sender, MAIN_MENU_TEXT, rows, fetchImpl, env);
  }

  /** One list. The person opens Menu, picks a row, then taps Send. */
  private async sendList(
    sender: string,
    lead: string,
    rows: MenuRow[],
    fetchImpl: typeof fetch,
    env: NodeJS.ProcessEnv,
  ): Promise<void> {
    await sendReplyList(sender, lead, rows, {
      button: 'Menu',
      fetchImpl,
      env,
    });
  }

  private async renderSection(
    choice: MenuId,
    deps: ChatbotDeps,
    limit = TOP,
    now = new Date(),
  ): Promise<string> {
    const title = SECTION_TITLE[choice];
    const todayFirst = limit > TOP;
    if (choice === 'news')
      return formatSection(
        title,
        (await this.newsBriefs(deps, limit, todayFirst, now)).map(newsLine),
        limit,
      );
    if (choice === 'analytics')
      return formatSection(
        title,
        analyticsLines(await this.newsBriefs(deps, 200, false, now)),
        4,
      );
    const section = RECORD_SECTION[choice];
    const rows = section
      ? await this.sectionRecords(section, deps, limit, todayFirst, now)
      : [];
    return formatSection(title, rows.map(recordLine), limit);
  }

  private async newsBriefs(
    deps: ChatbotDeps,
    limit = TOP,
    todayFirst = false,
    now = new Date(),
  ): Promise<NewsBrief[]> {
    const briefs = deps.news || (await this.loadNews());
    const seen = new Set<string>();
    const unique = newestFirst(briefs).filter((brief) => {
      const key = brief.title.trim().toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return preferToday(
      unique,
      (brief) => brief.publishedAt || brief.collectedAt,
      limit,
      todayFirst,
      now,
    );
  }

  private async sectionRecords(
    section: 'grievances' | 'projects' | 'people' | 'campaigns' | 'visits',
    deps: ChatbotDeps,
    limit = TOP,
    todayFirst = false,
    now = new Date(),
  ): Promise<MenuRecord[]> {
    if (this.db && isDemoDataEnabled()) {
      if (section === 'campaigns') await this.ensureMockCampaigns();
      if (section === 'projects')
        await this.ensureSamples('projects', DEMO_PROJECTS);
      if (section === 'people')
        await this.ensureSamples('people', MOCK_CONSTITUENCY);
      if (section === 'grievances') {
        await this.ensureMockGrievances();
        await this.stampMockReporters();
      }
    }
    const mapRow = (row: object): MenuRecord => {
      const source = row as Record<string, unknown>;
      const stages = stagesOf(source.progressStages);
      return {
        id:
          idOf(source.id) ||
          idOf(source._id) ||
          text(source.sourceMessageId) ||
          text(source.title),
        title: text(source.title),
        detail: [
          formatVisitTime(text(source.visitTime)),
          text(source.place),
          text(source.detail),
        ]
          .filter(Boolean)
          .join(' – '),
        status: text(source.status) || 'Open',
        date:
          text(source.visitDate) || text(source.date) || text(source.createdAt),
        issue:
          text(source.issue) ||
          stripPriority(text(source.detail)) ||
          text(source.title),
        place: text(source.place),
        department: text(source.followUpDepartment || source.department),
        leader: text(source.leader),
        language:
          source.language === 'te' || source.language === 'en'
            ? source.language
            : undefined,
        createdBy: text(source.createdBy),
        reporterPhone: text(source.reporterPhone),
        source: text(source.source),
        priority:
          source.priority === 'high' || source.priority === 'normal'
            ? source.priority
            : classifyGrievance(`${text(source.title)} ${text(source.detail)}`)
                .priority,
        progressToken: text(source.progressToken),
        progressStages: stages,
        progressRemarks: text(source.progressRemarks || source.remarks),
        progressUpdatedAt: text(source.progressUpdatedAt),
        section,
      };
    };
    const isFiltered = (row: {
      source?: unknown;
      title?: unknown;
      detail?: unknown;
    }) => !isDemoDataEnabled() && isDemoDoc(row);
    if (deps.records) {
      const mapped = (deps.records[section] || [])
        .filter((row) => !isFiltered(row))
        .map((row) => mapRow(row));
      const unique =
        section === 'grievances'
          ? uniqueRecords(mapped).filter(isOpenGrievance)
          : uniqueRecords(mapped);
      if (section === 'grievances' && limit > TOP) return unique;
      return preferToday(
        latestRecords(unique, limit * 4),
        (row) => row.date,
        limit,
        todayFirst,
        now,
      );
    }
    if (
      this.workspace &&
      (section === 'grievances' || section === 'projects')
    ) {
      try {
        const workspaceRecords = await this.workspace.list(section);
        const mapped = workspaceRecords
          .filter((r) => !isFiltered(r))
          .map((r) => ({
            id: r.id,
            title: r.fullName || r.title,
            detail: r.detail,
            status: r.status,
            date: r.date,
            issue: r.detail || r.title,
            place: r.place,
            department: r.followUpDepartment || r.department,
            leader: r.leader,
            createdBy: r.createdBy,
            reporterPhone: r.contactNumber,
            priority: classifyGrievance(`${r.title} ${r.detail}`).priority,
            progressToken: r.progressToken,
            progressStages: r.progressStages,
            progressRemarks: r.progressRemarks || r.remarks,
            progressUpdatedAt: r.progressUpdatedAt,
            section,
          }));
        const unique =
          section === 'grievances'
            ? uniqueRecords(mapped).filter(isOpenGrievance)
            : uniqueRecords(mapped);
        if (section === 'grievances' && limit > TOP) return unique;
        return preferToday(
          latestRecords(unique, limit * 4),
          (row) => row.date,
          limit,
          todayFirst,
          now,
        );
      } catch (err) {
        this.logger.warn(
          `WorkspaceService list failed for ${section}: ${err instanceof Error ? err.message : 'error'}`,
        );
      }
    }
    if (!this.db) return [];
    try {
      const ok = await this.db.ensureConnected();
      if (!ok) return [];
      const rows = (
        await this.db
          .collection(RECORDS)
          .find({ section })
          .sort({ createdAt: -1 })
          .limit(Math.max(limit, TOP) * 4)
          .toArray()
      ).filter((row) => !isFiltered(row));
      const unique = uniqueRecords(rows.map((row) => mapRow(row)));
      const visible =
        section === 'grievances' ? unique.filter(isOpenGrievance) : unique;
      if (section === 'grievances' && limit > TOP) return visible;
      return preferToday(
        latestRecords(visible, limit * 4),
        (row) => row.date,
        limit,
        todayFirst,
        now,
      );
    } catch (err) {
      this.logger.warn(
        `Chatbot could not load ${section}: ${err instanceof Error ? err.message : 'database error'}`,
      );
      return [];
    }
  }

  /**
   * Answers user questions about constituency problems, grievances, department progress,
   * locations, and related records using EXCLUSIVELY the website's configured database.
   */
  async answerConstituencyQuery(
    sender: string,
    query: string,
    fetchImpl: typeof fetch,
    env: NodeJS.ProcessEnv,
    deps: ChatbotDeps,
  ): Promise<void> {
    const dbConnected = deps.records
      ? true
      : this.db
        ? await this.db.ensureConnected()
        : false;
    if (!dbConnected) {
      await sendTextMessage(
        sender,
        'The constituency database is temporarily unavailable. Please try again in a few moments.',
        fetchImpl,
        env,
      );
      await this.sendMenu(sender, MAIN_MENU_TEXT, fetchImpl, env);
      return;
    }

    const results = await this.queryConstituencyRecords(query, deps);
    if (!results.length) {
      const response = `No matching information was found in the constituency database for: "${clip(query, 60)}". Please check the problem details, ID, or location.\n\nYou can also browse the sections below.`;
      await sendTextMessage(sender, response, fetchImpl, env);
      await this.sendMenu(sender, MAIN_MENU_TEXT, fetchImpl, env);
      return;
    }

    const topRecords = results.slice(0, 3);
    const aiAnswer = await this.generateGroundedAnswer(
      query,
      topRecords,
      fetchImpl,
      env,
    );
    if (aiAnswer) {
      await sendTextMessage(sender, aiAnswer, fetchImpl, env);
    } else {
      const fallbackText = formatRecordQueryResponse(query, topRecords);
      await sendTextMessage(sender, fallbackText, fetchImpl, env);
    }
    await this.sendMenu(sender, MAIN_MENU_TEXT, fetchImpl, env);
  }

  async queryConstituencyRecords(
    query: string,
    deps: ChatbotDeps,
  ): Promise<MenuRecord[]> {
    const rawTokens = query
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .split(/\s+/)
      .filter((t) => t.length >= 2);
    const stopWords = new Set([
      'what',
      'is',
      'the',
      'of',
      'in',
      'at',
      'on',
      'for',
      'to',
      'how',
      'status',
      'check',
      'give',
      'me',
      'tell',
      'about',
      'and',
      'any',
      'update',
      'progress',
    ]);
    const tokens = rawTokens.filter((t) => !stopWords.has(t));
    const searchTerms = tokens.length ? tokens : rawTokens;

    let candidateRecords: MenuRecord[] = [];
    if (deps.records) {
      const all: MenuRecord[] = [];
      for (const list of Object.values(deps.records)) {
        if (list) all.push(...list);
      }
      candidateRecords = all.filter((r) => !isDemoDoc(r));
    } else if (this.workspace) {
      try {
        const grievances = await this.workspace.list('grievances');
        const projects = await this.workspace.list('projects');
        candidateRecords = [...grievances, ...projects]
          .filter(
            (r) =>
              isDemoDataEnabled() ||
              (!r.id.startsWith('demo-') && !isDemoDoc(r)),
          )
          .map((r) => ({
            id: r.id,
            title: r.fullName || r.title,
            detail: r.detail,
            status: r.status,
            date: r.date,
            place: r.place,
            department: r.followUpDepartment || r.department,
            leader: r.leader,
            progressToken: r.progressToken,
            progressStages: r.progressStages,
            progressRemarks: r.progressRemarks || r.remarks,
            progressUpdatedAt: r.progressUpdatedAt,
            section: r.section,
          }));
      } catch {
        // Fall back to direct database query below
      }
    }
    if (!candidateRecords.length && this.db) {
      try {
        const rows = await this.db
          .collection(RECORDS)
          .find({ section: { $in: ['grievances', 'projects', 'people'] } })
          .limit(200)
          .toArray();
        candidateRecords = rows
          .filter((r) => isDemoDataEnabled() || !isDemoDoc(r))
          .map((r) => ({
            id: idOf(r.id) || idOf(r._id) || text(r.title),
            title: text(r.title),
            detail: text(r.detail),
            status: text(r.status) || 'Open',
            date: text(r.dateOfVisit) || text(r.visitDate) || text(r.createdAt),
            place: text(r.place),
            department: text(r.followUpDepartment) || text(r.department),
            leader: text(r.leader),
            progressStages: stagesOf(r.progressStages),
            progressRemarks: text(r.progressRemarks || r.remarks),
            progressUpdatedAt: text(r.progressUpdatedAt),
            section: text(r.section),
          }));
      } catch {
        candidateRecords = [];
      }
    }

    const scored = candidateRecords.map((rec) => {
      let score = 0;
      const haystack = [
        rec.id,
        rec.title,
        rec.detail,
        rec.place,
        rec.department,
        rec.status,
        rec.progressRemarks,
        rec.section,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      if (rec.id && query.toLowerCase().includes(rec.id.toLowerCase()))
        score += 20;
      if (rec.title && query.toLowerCase().includes(rec.title.toLowerCase()))
        score += 10;
      if (
        rec.department &&
        query.toLowerCase().includes(rec.department.toLowerCase())
      )
        score += 5;
      if (rec.place && query.toLowerCase().includes(rec.place.toLowerCase()))
        score += 5;

      for (const token of searchTerms) {
        if (haystack.includes(token)) score += 3;
      }
      return { rec, score };
    });

    return scored
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((item) => item.rec);
  }

  private async generateGroundedAnswer(
    query: string,
    records: MenuRecord[],
    fetchImpl: typeof fetch,
    env: NodeJS.ProcessEnv,
  ): Promise<string | null> {
    const keys = discoverGroqApiKeys(env);
    if (!keys.length) return null;

    const recordSnippets = records
      .map((r, i) => {
        const parts = [
          `Record #${i + 1}:`,
          `Title: ${r.title}`,
          `Section: ${r.section || 'Grievance'}`,
          `Status: ${r.status}`,
          `Department: ${r.department || 'Not assigned'}`,
          `Location: ${r.place || 'Not specified'}`,
        ];
        if (r.progressStages?.length) {
          parts.push(`Progress Stages: ${stageSummary(r.progressStages)}`);
          const activeStage =
            r.progressStages.find((s) => s.status === 'In progress') ||
            r.progressStages[0];
          if (activeStage?.note)
            parts.push(`Current Stage Note: ${activeStage.note}`);
        }
        if (r.progressRemarks)
          parts.push(`Department Remarks: ${r.progressRemarks}`);
        if (r.progressUpdatedAt)
          parts.push(`Last Updated: ${shortWhen(r.progressUpdatedAt)}`);
        return parts.join('\n');
      })
      .join('\n\n');

    const systemPrompt =
      'You are the JanaVignanam / MediaSphere constituency intelligence assistant. ' +
      'Answer the user inquiry factually using ONLY the retrieved database records below.\n' +
      'Strict Grounding Rules:\n' +
      '1. State the exact progress status, department, location, stages, and remarks found in the records.\n' +
      '2. Do NOT invent, assume, or extrapolate any progress, remarks, deadlines, or department decisions.\n' +
      '3. If specific requested information is not in the records, state that it is not recorded in the database.\n' +
      '4. Do not include internal database IDs, passwords, or secret tokens.\n' +
      '5. Format for WhatsApp using *bold* and bullet points. Keep it clear and concise.\n' +
      '6. Respond in the language of the query (English or Telugu).';

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 6000);
      const groqFetch =
        typeof globalThis.fetch === 'function' ? globalThis.fetch : fetchImpl;
      const response = await groqFetch(
        'https://api.groq.com/openai/v1/chat/completions',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${keys[0]}`,
            'Content-Type': 'application/json',
          },
          signal: controller.signal,
          body: JSON.stringify({
            model: env.GROQ_MODEL || 'openai/gpt-oss-120b',
            temperature: 0.1,
            max_tokens: 450,
            messages: [
              { role: 'system', content: systemPrompt },
              {
                role: 'user',
                content: `Retrieved Database Records:\n${recordSnippets}\n\nUser Question: ${query}`,
              },
            ],
          }),
        },
      ).finally(() => clearTimeout(timer));
      if (!response.ok) return null;
      const data = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = data.choices?.[0]?.message?.content?.trim();
      return content ? toWhatsAppFormat(content) : null;
    } catch {
      return null;
    }
  }

  private async loadNews(): Promise<NewsBrief[]> {
    if (!this.articles) return [];
    if (this.newsCache && Date.now() - this.newsCache.at < NEWS_CACHE_MS)
      return this.newsCache.briefs;
    try {
      const docs = await this.articles.findAll();
      const briefs = docs
        .filter((doc) => hasAssemblySegment(doc))
        .map((doc) => toBrief(doc as Record<string, unknown>))
        .filter((brief): brief is NewsBrief => brief !== null);
      this.newsCache = { at: Date.now(), briefs };
      this.logger.log(`Chatbot news loaded (${briefs.length} articles).`);
      return briefs;
    } catch (err) {
      this.logger.warn(
        `Chatbot could not load news: ${err instanceof Error ? err.message : 'database error'}`,
      );
      return this.newsCache?.briefs || [];
    }
  }

  private enqueue(sender: string, work: () => Promise<void>): Promise<void> {
    const previous = this.queues.get(sender) ?? Promise.resolve();
    const current = previous.then(work, work);
    this.queues.set(
      sender,
      current.then(
        () => undefined,
        () => undefined,
      ),
    );
    return current;
  }
}

export function chatbotEnabled(env: NodeJS.ProcessEnv): boolean {
  const flag = (env.CHATBOT_ENABLED ?? 'true').trim().toLowerCase();
  const whatsapp = (env.WHATSAPP_ENABLED || '').trim().toLowerCase();
  return (
    ['1', 'true', 'yes', 'on'].includes(flag) &&
    ['1', 'true', 'yes', 'on'].includes(whatsapp)
  );
}

export function grievancePick(event: WhatsAppEvent): string | null {
  const id = replyId(event);
  return id.toLowerCase().startsWith('g:') &&
    !id.toLowerCase().startsWith('gf:')
    ? id.slice(2)
    : null;
}

export function grievanceFollow(event: WhatsAppEvent): string | null {
  const id = replyId(event);
  return id.toLowerCase().startsWith('gf:') ? id.slice(3) : null;
}

export function followupContactId(event: WhatsAppEvent): string | null {
  const id = replyId(event);
  return id.toLowerCase().startsWith('fu:c:') ? id.slice(5) : null;
}

const FOLLOWUP_BUCKET_TITLE: Record<FollowupBucket, string> = {
  recent: 'Recent Follow-ups',
  frequent: 'Frequently Followed Up',
  pending: 'Not followed up',
};

function chunkRows<T>(rows: T[], size: number): T[][] {
  const pages: T[][] = [];
  for (let index = 0; index < rows.length; index += size)
    pages.push(rows.slice(index, index + size));
  return pages;
}

function replyId(event: WhatsAppEvent): string {
  const reply =
    event.interactive_response?.list_reply ||
    event.interactive_response?.button_reply;
  if (!reply || typeof reply !== 'object') return '';
  return text((reply as Record<string, unknown>).id);
}

export function menuChoice(event: WhatsAppEvent): MenuChoice | null {
  const reply =
    event.interactive_response?.list_reply ||
    event.interactive_response?.button_reply;
  if (reply && typeof reply === 'object') {
    const row = reply as Record<string, unknown>;
    const id = text(row.id).toLowerCase();
    const match = CHOICE_BUTTONS.find((button) => button.id === id);
    if (match) return match.id as MenuChoice;
    const fromTitle = menuFromText(text(row.title) || event.message_text || '');
    if (fromTitle) return fromTitle;
  }
  if (
    event.event_type === 'text' ||
    event.event_type === 'button' ||
    event.event_type === 'interactive'
  ) {
    return menuFromText(event.message_text || '');
  }
  return null;
}

export function menuFromText(value: string): MenuChoice | null {
  const key = value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}&]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return TEXT_ALIASES[key] || null;
}

export function formatSection(
  title: string,
  items: string[],
  limit = TOP,
): string {
  if (!items.length) return `*${title}*\nNothing saved yet.`;
  const lines = items
    .slice(0, limit)
    .map((item, index) => `${index + 1}. ${item}`);
  return `*${title}*\n\n${lines.join('\n\n')}`;
}

function newsLine(brief: NewsBrief): string {
  const meta = [
    readable(brief.place),
    shortWhen(brief.publishedAt || brief.collectedAt),
  ]
    .filter(Boolean)
    .join(' · ');
  return [boldFull(brief.title), readable(brief.summary), meta]
    .filter(Boolean)
    .join('\n');
}

function boldFull(value: string): string {
  const cleaned = readable(value);
  return cleaned ? `*${cleaned}*` : '';
}

function readable(value: string): string {
  return value
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Keeps each news item whole. A piece is split only when one item is longer than a WhatsApp text. */
export function completeParts(body: string, limit = TEXT_LIMIT): string[] {
  const blocks = body
    .split(/\n\n/)
    .map((block) => block.trim())
    .filter(Boolean);
  const parts: string[] = [];
  let current = '';
  const push = (value: string) => {
    const cleaned = value.trim();
    if (cleaned) parts.push(cleaned);
  };
  for (const block of blocks) {
    if (block.length > limit) {
      push(current);
      current = '';
      let rest = block;
      while (rest.length > limit) {
        const cut = sentenceEnd(rest, limit);
        push(rest.slice(0, cut));
        rest = rest.slice(cut).trim();
      }
      current = rest;
      continue;
    }
    const next = current ? `${current}\n\n${block}` : block;
    if (next.length <= limit) {
      current = next;
      continue;
    }
    push(current);
    current = block;
  }
  push(current);
  return parts;
}

function sentenceEnd(value: string, limit: number): number {
  const window = value.slice(0, limit);
  const at = Math.max(
    window.lastIndexOf('. '),
    window.lastIndexOf('। '),
    window.lastIndexOf('\n'),
  );
  return at > 40 ? at + 1 : limit;
}

function analyticsLines(briefs: NewsBrief[]): string[] {
  if (!briefs.length)
    return isDemoDataEnabled()
      ? MOCK_ANALYTICS
      : [
          '*Narasaraopet constituency*\nNo articles recorded in the database yet.',
        ];
  const placeOf = (place: string) => plain(place).split(',')[0]?.trim() || '';
  return [
    `*Narasaraopet constituency*\n${briefs.length} articles counted`,
    `*Sentiment*\n${tally(briefs.map((brief) => plain(brief.sentiment)))}`,
    `*Issues*\n${tally(briefs.map((brief) => plain(brief.category)))}`,
    `*Places*\n${tally(briefs.map((brief) => placeOf(brief.place)))}`,
  ];
}

function tally(values: string[]): string {
  const counts = new Map<string, number>();
  for (const value of values) {
    const key = value.trim();
    if (!key) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()]
    .sort(
      (left, right) => right[1] - left[1] || left[0].localeCompare(right[0]),
    )
    .slice(0, 4)
    .map(([name, count]) => `${name} ${count}`)
    .join(' · ');
}

function recordLine(row: MenuRecord): string {
  const metaParts = [plain(row.status || 'Open'), shortWhen(row.date)].filter(
    Boolean,
  );
  if (row.department) metaParts.unshift(row.department);
  const meta = metaParts.join(' · ');
  const lines = [bold(row.title), plain(row.detail), meta];
  if (row.progressRemarks) lines.push(`Remarks: ${plain(row.progressRemarks)}`);
  return lines.filter(Boolean).join('\n');
}

function uniqueRecords(rows: MenuRecord[]): MenuRecord[] {
  const seen = new Set<string>();
  const unique: MenuRecord[] = [];
  for (const row of rows) {
    const key = `${row.title}|${row.date}|${row.detail}`.toLowerCase();
    if (!row.title || seen.has(key)) continue;
    seen.add(key);
    unique.push(row);
  }
  return unique;
}

function latestRecords(rows: MenuRecord[], limit = TOP): MenuRecord[] {
  return [...rows]
    .sort((left, right) => timeOf(right.date) - timeOf(left.date))
    .slice(0, limit);
}

function preferToday<T>(
  items: T[],
  dateOf: (item: T) => string,
  limit: number,
  todayFirst: boolean,
  now: Date,
): T[] {
  if (!todayFirst) return items.slice(0, limit);
  const today = todayInIndia(now);
  const onDay = items.filter((item) => dateOf(item).slice(0, 10) === today);
  const rest = items.filter((item) => dateOf(item).slice(0, 10) !== today);
  return [...onDay, ...rest].slice(0, limit);
}

function byPriority(rows: MenuRecord[]): MenuRecord[] {
  const rank = (row: MenuRecord) => (row.priority === 'high' ? 0 : 1);
  return [...rows].sort(
    (left, right) =>
      rank(left) - rank(right) || timeOf(right.date) - timeOf(left.date),
  );
}

function grievanceView(row: MenuRecord): string {
  const issue = issueOf(row);
  const desk = assignDesk(issue);
  const lines = [
    boldFull(issue),
    `Status: *${row.status || 'Open'}*`,
    `Location: ${row.place || desk.place}`,
    `Department: ${row.department || desk.department}`,
    priorityLabel(row.priority || 'normal'),
  ];
  if (row.progressStages && row.progressStages.length) {
    lines.push(`Progress: ${stageSummary(row.progressStages)}`);
  }
  if (row.progressRemarks) {
    lines.push(`Remarks: ${row.progressRemarks}`);
  }
  if (row.progressUpdatedAt) {
    lines.push(`Updated: ${shortWhen(row.progressUpdatedAt)}`);
  }
  return lines.filter(Boolean).join('\n');
}

function issueOf(row: MenuRecord): string {
  return stripPriority(row.issue || row.detail || row.title);
}

function isOpenGrievance(row: MenuRecord): boolean {
  const status = row.status.trim().toLowerCase();
  return (
    status !== 'reviewed' && status !== 'resolved' && status !== 'approved'
  );
}

function progressPageUrl(env: NodeJS.ProcessEnv, token: string): string {
  const base = (env.PUBLIC_APP_URL || 'https://janavignanam-three.vercel.app')
    .trim()
    .replace(/\/$/, '');
  return `${base}/progress/${token}`;
}

function sameGrievance(row: MenuRecord, picked: MenuRecord): boolean {
  if (picked.id && row.id === picked.id) return true;
  return Boolean(picked.title) && row.title === picked.title;
}

/** The person who raised this issue. Only returns real stored contact information unless demo data is enabled. */
function raiserPhone(row: MenuRecord): string | null {
  const stored = digitsOf(row.reporterPhone || '');
  if (stored) return stored;
  const createdBy = (row.createdBy || '').trim();
  if (createdBy && createdBy !== 'Sample' && !createdBy.includes('@')) {
    const named = phoneForName(createdBy);
    if (named) return named;
  }
  if (isDemoDataEnabled()) {
    const sample = MOCK_GRIEVANCES.find(
      (item) => item.title.toLowerCase() === row.title.trim().toLowerCase(),
    );
    return sample ? phoneForName(sample.reporter) : null;
  }
  return null;
}

function stagesOf(value: unknown): ProgressStage[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const stage = item as Record<string, unknown>;
    const status =
      stage.status === 'Completed' ||
      stage.status === 'In progress' ||
      stage.status === 'Pending'
        ? stage.status
        : 'Pending';
    const name = text(stage.name);
    if (!name) return [];
    return [{ name, status, note: text(stage.note) }];
  });
}

function stageSummary(stages: ProgressStage[]): string {
  if (!stages.length) return '';
  const completed = stages.filter(
    (stage) => stage.status === 'Completed',
  ).length;
  const active = stages.filter(
    (stage) => stage.status === 'In progress',
  ).length;
  const pending = stages.filter((stage) => stage.status === 'Pending').length;
  return `${completed} completed, ${active} in progress, ${pending} pending`;
}

function formatRecordQueryResponse(
  query: string,
  records: MenuRecord[],
): string {
  const lines: string[] = ['*Constituency Database Records*'];
  for (const [index, r] of records.entries()) {
    const parts = [
      `*${index + 1}. ${clip(r.title, 80)}*`,
      `• Status: *${r.status || 'Open'}*`,
      `• Department: ${r.department || 'Not assigned'}`,
      `• Location: ${r.place || 'Constituency'}`,
    ];
    if (r.progressStages && r.progressStages.length) {
      parts.push(`• Progress: ${stageSummary(r.progressStages)}`);
    }
    if (r.progressRemarks) {
      parts.push(`• Remarks: ${r.progressRemarks}`);
    }
    if (r.progressUpdatedAt) {
      parts.push(`• Updated: ${shortWhen(r.progressUpdatedAt)}`);
    }
    lines.push(parts.join('\n'));
  }
  return lines.join('\n\n');
}

function digitsOf(value: string): string {
  const digits = value.replace(/\D/g, '');
  return digits.length >= 10 ? digits : '';
}

function stripPriority(value: string): string {
  return value.replace(/^(High priority|Normal)\s*[—-]\s*/i, '').trim();
}

function bold(value: string): string {
  const cleaned = plain(value);
  return cleaned ? `*${cleaned}*` : '';
}

function plain(value: string): string {
  return clip(
    value
      .replace(/https?:\/\/\S+/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
    180,
  );
}

function clip(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1).trimEnd()}…`;
}

function shortWhen(value: string): string {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return '';
  return new Date(parsed).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Kolkata',
  });
}

function timeOf(value: string): number {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function idOf(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (
    value &&
    typeof value === 'object' &&
    'toHexString' in value &&
    typeof (value as { toHexString?: () => string }).toHexString === 'function'
  ) {
    return (value as { toHexString: () => string }).toHexString();
  }
  return '';
}

const REPLY_TIMEOUT_MS = 20_000;

/** A stuck WhatsApp call must not hold later replies from the same admin. */
function replyFetch(fetchImpl: typeof fetch): typeof fetch {
  return async (input, init) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REPLY_TIMEOUT_MS);
    try {
      return await fetchImpl(input, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  };
}

function allowlist(env: NodeJS.ProcessEnv): string[] {
  if (staffDirectoryLoaded()) return replyRecipients();
  const numbers: string[] = [];
  for (const item of (env.WHATSAPP_RECIPIENTS || '').split(',')) {
    const trimmed = item.trim();
    if (!trimmed) continue;
    try {
      numbers.push(normalizePhone(trimmed));
    } catch {
      // Invalid entries are ignored. They are not logged.
    }
  }
  return numbers;
}

function grievanceDetail(event: WhatsAppEvent): string {
  const written = (event.message_text || '').trim();
  if (written) return written.slice(0, 2000);
  const notes: Record<string, string> = {
    image: 'Sent a photo.',
    audio: 'Sent a voice note.',
    video: 'Sent a video.',
    document: 'Sent a document.',
    sticker: 'Sent a sticker.',
  };
  return notes[event.event_type] || 'Sent a message.';
}

function digits(value: string): string {
  try {
    return normalizePhone(value);
  } catch {
    return '';
  }
}

function maskPhone(value: string): string {
  const phone = value.replace(/\D/g, '');
  if (phone.length < 6) return '******';
  return `${phone.slice(0, 2)}***${phone.slice(-2)}`;
}

export function timeGreeting(now: Date): string {
  const hour = Number(
    new Intl.DateTimeFormat('en-GB', {
      hour: 'numeric',
      hourCycle: 'h23',
      timeZone: 'Asia/Kolkata',
    }).format(now),
  );
  if (hour >= 5 && hour < 12) return 'Good morning';
  if (hour >= 12 && hour < 17) return 'Good afternoon';
  return 'Good evening';
}

export function openingLine(now: Date, env: NodeJS.ProcessEnv): string {
  const addressee =
    (env.CHATBOT_ADDRESSEE || DEFAULT_ADDRESSEE).trim() || DEFAULT_ADDRESSEE;
  return `${timeGreeting(now)}, ${addressee}! I'm your Media Assistant.`;
}

const GREETING_WORDS = new Set([
  'hi',
  'hii',
  'hiii',
  'hello',
  'helo',
  'hey',
  'hai',
  'namaste',
  'namasthe',
  'namaskaram',
  'namaskar',
  'good',
  'morning',
  'afternoon',
  'evening',
  'gm',
  'sir',
  'garu',
  'there',
  'assistant',
  'bot',
  'again',
  'who',
  'are',
  'you',
  'u',
  'help',
  'info',
  'నమస్కారం',
  'నమస్తే',
  'హాయ్',
  'హలో',
  'శుభోదయం',
  'సార్',
  'గారు',
]);

/** True for a bare greeting such as "Hi", "Hello sir", "Good evening", or "నమస్కారం". */
export function isGreetingOnly(text: string): boolean {
  const words = text
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
  return (
    words.length > 0 &&
    words.length <= 4 &&
    words.every((word) => GREETING_WORDS.has(word))
  );
}

export function toWhatsAppFormat(value: string): string {
  return value
    .replace(/\*\*(.+?)\*\*/g, '*$1*')
    .replace(/__(.+?)__/g, '_$1_')
    .replace(/^#{1,6}\s+/gm, '')
    .trim();
}
