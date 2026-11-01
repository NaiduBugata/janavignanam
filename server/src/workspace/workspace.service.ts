import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';
import { ObjectId } from 'mongodb';
import { DatabaseService } from '../database/database.service';
import {
  demoProjectDocs,
  isDemoDataEnabled,
  isDemoDoc,
} from '../admin/demo-data';
import {
  assignDesk,
  DEPARTMENT_WHATSAPP,
  DESKS,
  GENERAL_DESK,
  leaderApproval,
  messageLanguage,
  raiserApproval,
} from '../chatbot/grievance-priority';
import { phoneForName } from '../whatsapp/whatsapp.audience';
import {
  recordOutboundAttempt,
  sendReplyButtons,
  sendTemplateMessage,
  sendTextMessage,
  type ReplyButton,
} from '../whatsapp/whatsapp.send';
import {
  CASE_SECTIONS,
  TRACKED_SECTIONS,
  WORKSPACE_SECTIONS,
  type WorkspaceSection,
} from './workspace.dto';
import {
  GrokScannerService,
  type GrievanceExtractedData,
  type GrokScanResult,
} from './grok-scanner.service';
import {
  combinedPdf,
  defaultStages,
  recordsWorkbook,
  reportPdf,
  STAGE_NAMES,
  type ProgressStage,
  type ReportRow,
} from './progress-report';

const USERS = 'jv_users';
const RECORDS = 'jv_records';

export interface WorkspaceUser {
  id: string;
  email: string;
  name: string;
}

export interface ProgressHistoryEntry {
  timestamp: string;
  status: string;
  remarks: string;
  department: string;
  stages?: ProgressStage[];
}

export interface SaveProgressInput {
  stages?: ProgressStage[];
  status?: string;
  remarks?: string;
  department?: string;
}

export interface GrievanceDocument {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: string;
  status: 'processing' | 'completed' | 'failed';
  extractedText?: string;
  structuredData?: GrievanceExtractedData;
  errorMessage?: string;
  fileData?: string;
}

export interface WorkspaceRecord {
  id: string;
  section: WorkspaceSection;
  title: string;
  detail: string;
  status: string;
  date: string;
  createdBy: string;
  followUpDepartment: string;
  srNumber: string;
  fullName: string;
  contactNumber: string;
  address: string;
  email: string;
  village: string;
  mandal: string;
  division: string;
  assemblyConstituency: string;
  dateOfVisit: string;
  referenceName: string;
  referenceNumber: string;
  categories: string[];
  others: string;
  actionTaken: string;
  actionToBeTaken: string;
  assignedOfficer: string;
  resolutionStatus: string;
  deadline: string;
  place: string;
  visitDate: string;
  visitTime: string;
  leadPhone: string;
  progressToken: string;
  progressStages: ProgressStage[];
  progressUpdatedAt: string;
  remarks?: string;
  progressRemarks?: string;
  progressHistory?: ProgressHistoryEntry[];
  department: string;
  leader: string;
  workStartedNotifiedAt?: string;
  scannedDocuments?: GrievanceDocument[];
}

type CaseInput = {
  srNumber?: string;
  fullName?: string;
  contactNumber?: string;
  address?: string;
  email?: string;
  village?: string;
  mandal?: string;
  division?: string;
  assemblyConstituency?: string;
  dateOfVisit?: string;
  referenceName?: string;
  referenceNumber?: string;
  categories?: string[];
  others?: string;
  actionTaken?: string;
  actionToBeTaken?: string;
  assignedOfficer?: string;
  resolutionStatus?: string;
  deadline?: string;
  place?: string;
  visitDate?: string;
  visitTime?: string;
  leadPhone?: string;
};

@Injectable()
export class WorkspaceService {
  constructor(
    private readonly db: DatabaseService,
    private readonly config: ConfigService,
    private readonly grokScanner: GrokScannerService = new GrokScannerService(
      config,
    ),
  ) {}

  async register(
    email: string,
    password: string,
    name?: string,
  ): Promise<{ token: string; user: WorkspaceUser }> {
    await this.ready();
    const normalized = email.trim().toLowerCase();
    const existing = await this.db
      .collection(USERS)
      .findOne({ email: normalized });
    if (existing)
      throw new ConflictException('An account with this email already exists');
    const display = (name || normalized.split('@')[0]).trim();
    const inserted = await this.db.collection(USERS).insertOne({
      email: normalized,
      name: display,
      passwordHash: hashPassword(password),
      createdAt: new Date().toISOString(),
    });
    const user = {
      id: String(inserted.insertedId),
      email: normalized,
      name: display,
    };
    return { token: this.sign(user.id), user };
  }

  async login(
    email: string,
    password: string,
  ): Promise<{ token: string; user: WorkspaceUser }> {
    await this.ready();
    const normalized = email.trim().toLowerCase();
    const doc = await this.db.collection(USERS).findOne({ email: normalized });
    if (!doc || !verifyPassword(password, String(doc.passwordHash || ''))) {
      throw new UnauthorizedException('Email or password is incorrect');
    }
    const user = {
      id: String(doc._id),
      email: normalized,
      name: String(doc.name || normalized.split('@')[0]),
    };
    return { token: this.sign(user.id), user };
  }

  async me(token: string): Promise<WorkspaceUser> {
    const id = this.verify(token);
    await this.ready();
    const doc = await this.db.collection(USERS).findOne({ _id: asId(id) });
    if (!doc) throw new UnauthorizedException('Session expired');
    return { id, email: String(doc.email), name: String(doc.name || '') };
  }

  async list(section: WorkspaceSection): Promise<WorkspaceRecord[]> {
    await this.ready();
    const rows = await this.db
      .collection(RECORDS)
      .find({ section })
      .sort({ createdAt: -1 })
      .limit(200)
      .toArray();
    const visible = isDemoDataEnabled()
      ? rows
      : rows.filter((row) => !isDemoDoc(row));
    const shown =
      section === 'projects' && isDemoDataEnabled() && visible.length === 0
        ? demoProjectDocs()
        : visible;
    return shown.map(toRecord);
  }

  async create(
    input: {
      section: WorkspaceSection;
      title?: string;
      detail?: string;
      status?: string;
      createdBy: string;
    } & CaseInput,
  ): Promise<WorkspaceRecord> {
    await this.ready();
    const createdAt = new Date().toISOString();
    const visitor = (CASE_SECTIONS as readonly string[]).includes(
      input.section,
    );
    const doc = {
      section: input.section,
      title: (visitor ? input.fullName || '' : input.title || '').trim(),
      detail: (input.detail || (visitor ? caseDetail(input) : '')).trim(),
      status:
        (visitor ? input.resolutionStatus : input.status || 'Open') || 'Open',
      createdAt,
      createdBy: input.createdBy,
      ...(visitor ? storedCase(input) : simpleStored(input)),
      ...((TRACKED_SECTIONS as readonly string[]).includes(input.section)
        ? {
            progressToken: randomBytes(9).toString('hex'),
            progressStages: defaultStages(),
            progressUpdatedAt: createdAt,
          }
        : {}),
    };
    const inserted = await this.db.collection(RECORDS).insertOne(doc);
    return toRecord({ ...doc, _id: inserted.insertedId });
  }

  async update(id: string, input: CaseInput): Promise<WorkspaceRecord> {
    await this.ready();
    const existing = await this.storedRecord(id);
    const visitor = (CASE_SECTIONS as readonly string[]).includes(
      String(existing.section || ''),
    );
    const saved = await this.db
      .collection(RECORDS)
      .findOneAndUpdate(
        { _id: asId(id) },
        { $set: visitor ? storedCase(input) : simpleStored(input) },
      );
    if (!saved) throw new NotFoundException('Record not found');
    return toRecord({ ...existing, ...saved });
  }

  async remove(id: string): Promise<{ deleted: true }> {
    await this.ready();
    await this.storedRecord(id);
    const result = await this.db
      .collection(RECORDS)
      .deleteOne({ _id: asId(id) });
    if (!result.deletedCount) throw new NotFoundException('Record not found');
    return { deleted: true };
  }

  private async readRecord(id: string): Promise<Record<string, unknown>> {
    if (id.startsWith('demo-')) {
      const sample = demoProjectDocs().find((doc) => String(doc._id) === id);
      if (!sample) throw new NotFoundException('Record not found');
      return sample;
    }
    const existing = await this.db
      .collection(RECORDS)
      .findOne({ _id: asId(id) });
    if (!existing) throw new NotFoundException('Record not found');
    return existing;
  }

  private async storedRecord(id: string): Promise<Record<string, unknown>> {
    const existing = await this.readRecord(id);
    if (id.startsWith('demo-') || isDemoDoc(existing))
      throw new BadRequestException('Sample records cannot be changed');
    return existing;
  }

  async get(id: string): Promise<WorkspaceRecord> {
    await this.ready();
    let doc = await this.readRecord(id);
    if (id.startsWith('demo-') || isDemoDoc(doc)) {
      const record = toRecord(doc);
      if (
        (TRACKED_SECTIONS as readonly string[]).includes(record.section) &&
        record.progressStages.length === 0
      ) {
        return { ...record, progressStages: defaultStages() };
      }
      return record;
    }
    const section = String(doc.section || '');
    if (
      (TRACKED_SECTIONS as readonly string[]).includes(section) &&
      !text(doc.progressToken)
    ) {
      const progressToken = randomBytes(9).toString('hex');
      const stages = stagesOf(doc.progressStages);
      const saved = await this.db.collection(RECORDS).findOneAndUpdate(
        { _id: asId(id) },
        {
          $set: {
            progressToken,
            ...(stages.length
              ? {}
              : {
                  progressStages: defaultStages(),
                  progressUpdatedAt: new Date().toISOString(),
                }),
          },
        },
      );
      if (saved) doc = saved;
    }
    return toRecord(doc);
  }

  async approve(
    id: string,
  ): Promise<{ record: WorkspaceRecord; notice: string }> {
    await this.ready();
    const existing = await this.readRecord(id);
    if (String(existing.section || '') !== 'grievances')
      throw new BadRequestException('Only a grievance can be approved');
    if (id.startsWith('demo-') || isDemoDoc(existing))
      throw new BadRequestException(
        'Sample grievances are not sent on WhatsApp',
      );
    if (String(existing.status || '') === 'Approved') {
      return {
        record: toRecord(existing),
        notice: 'This grievance is already approved.',
      };
    }
    const record = toRecord(existing);
    const issue = [record.detail, record.title, record.village, record.place]
      .filter(Boolean)
      .join(' ');
    const desk = assignDesk(issue);
    const language = messageLanguage(issue);
    const fresh = !text(existing.progressToken);
    const token =
      text(existing.progressToken) || randomBytes(9).toString('hex');
    const raiser = whatsappNumber(
      record.contactNumber || text(existing.reporterPhone),
    );
    const leaderPhone = phoneForName(desk.leader);

    let departmentInteractive = false;
    try {
      departmentInteractive = await sendDepartmentActionNotice(
        desk,
        issue,
        String(id),
        token,
        record,
      );
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'send failed';
      throw new BadRequestException(
        `The department message was not sent. The grievance was not approved. ${reason}`.slice(
          0,
          300,
        ),
      );
    }
    // Leader messaging disabled per user instruction: "do not send any msgs to leaders as of now, disable them i will tell you when it's needed"
    const LEADER_NOTIFICATIONS_ENABLED = false;
    const leaderSent =
      LEADER_NOTIFICATIONS_ENABLED && leaderPhone
        ? await sendQuiet(leaderPhone, leaderApproval(issue, desk))
        : false;
    const raiserSent = raiser
      ? await sendQuiet(raiser, raiserApproval(language))
      : false;

    const patch = {
      status: 'Approved',
      followUpDepartment: desk.department,
      followUpAt: new Date().toISOString(),
      progressToken: token,
      ...(fresh
        ? {
            progressStages: defaultStages(),
            progressUpdatedAt: new Date().toISOString(),
          }
        : {}),
    };
    const saved = await this.db
      .collection(RECORDS)
      .findOneAndUpdate({ _id: asId(id) }, { $set: patch });
    const notice = [
      'Approved.',
      raiserSent
        ? 'The person who raised it was messaged.'
        : 'The person who raised it has no WhatsApp number on this grievance.',
      LEADER_NOTIFICATIONS_ENABLED
        ? leaderSent
          ? `${desk.leader} was messaged.`
          : `${desk.leader} is not in the contact list.`
        : 'Leader notifications are paused.',
      departmentInteractive
        ? 'The department was sent the WhatsApp operations menu.'
        : 'Meta accepted the department template notification.',
    ].join(' ');
    return {
      record: toRecord({ ...existing, ...(saved || {}), ...patch }),
      notice,
    };
  }

  async addDocumentToGrievance(
    id: string,
    file: {
      buffer: Buffer;
      originalname: string;
      mimetype: string;
      size: number;
    },
  ): Promise<{ document: GrievanceDocument; record: WorkspaceRecord }> {
    await this.ready();
    const raw = await this.storedRecord(id);
    if (String(raw.section || '') !== 'grievances') {
      throw new BadRequestException(
        'Document scanning is only supported for grievances.',
      );
    }

    const docId = `gdoc_${Date.now()}_${randomBytes(4).toString('hex')}`;
    const now = new Date().toISOString();
    const base64File = file.buffer.toString('base64');

    const existingDocs = Array.isArray(raw.scannedDocuments)
      ? (raw.scannedDocuments as Array<Record<string, unknown>>)
      : Array.isArray(raw.documents)
        ? (raw.documents as Array<Record<string, unknown>>)
        : [];

    const initialDoc: Record<string, unknown> = {
      id: docId,
      filename: file.originalname || 'document',
      mimeType: file.mimetype || 'application/octet-stream',
      sizeBytes: file.size || file.buffer.length,
      uploadedAt: now,
      status: 'processing',
      fileData: base64File,
    };

    await this.db
      .collection(RECORDS)
      .findOneAndUpdate(
        { _id: asId(id) },
        { $set: { scannedDocuments: [...existingDocs, initialDoc] } },
      );

    let scanResult: GrokScanResult | null = null;
    let scanError: string | null = null;

    try {
      scanResult = await this.grokScanner.scanDocument({
        buffer: file.buffer,
        mimeType: file.mimetype,
        filename: file.originalname,
      });
    } catch (err) {
      scanError = err instanceof Error ? err.message : String(err);
    }

    const finalDoc: Record<string, unknown> = {
      ...initialDoc,
      status: scanResult ? 'completed' : 'failed',
      extractedText: scanResult?.extractedText || '',
      structuredData: scanResult?.structuredData || undefined,
      errorMessage: scanError || undefined,
    };

    const updatedDocs = [
      ...existingDocs.filter((d) => String(d.id) !== docId),
      finalDoc,
    ];

    const updatedRaw = await this.db
      .collection(RECORDS)
      .findOneAndUpdate(
        { _id: asId(id) },
        { $set: { scannedDocuments: updatedDocs } },
      );

    const updatedRecord = toRecord({
      ...(raw || {}),
      ...(updatedRaw || {}),
      scannedDocuments: updatedDocs,
    });
    const returnedDoc = documentsOf([finalDoc])[0];

    return {
      document: returnedDoc,
      record: updatedRecord,
    };
  }

  async getDocumentFile(
    recordId: string,
    docId: string,
  ): Promise<{ filename: string; mimeType: string; buffer: Buffer }> {
    await this.ready();
    const raw = await this.readRecord(recordId);
    const docs = (raw.scannedDocuments || raw.documents) as
      Array<Record<string, unknown>> | undefined;
    if (!Array.isArray(docs)) {
      throw new NotFoundException('No documents found for this grievance');
    }
    const match = docs.find((d) => String(d.id) === docId);
    if (!match) {
      throw new NotFoundException('Document not found');
    }
    const fileData = text(match.fileData);
    if (!fileData) {
      throw new NotFoundException('Document file content is not available');
    }
    return {
      filename: text(match.filename) || `grievance-${docId}`,
      mimeType: text(match.mimeType) || 'application/octet-stream',
      buffer: Buffer.from(fileData, 'base64'),
    };
  }

  async removeDocumentFromGrievance(
    recordId: string,
    docId: string,
  ): Promise<WorkspaceRecord> {
    await this.ready();
    const raw = await this.storedRecord(recordId);
    const existingDocs = Array.isArray(raw.scannedDocuments)
      ? (raw.scannedDocuments as Array<Record<string, unknown>>)
      : Array.isArray(raw.documents)
        ? (raw.documents as Array<Record<string, unknown>>)
        : [];

    const updatedDocs = existingDocs.filter((d) => String(d.id) !== docId);
    const updatedRaw = await this.db
      .collection(RECORDS)
      .findOneAndUpdate(
        { _id: asId(recordId) },
        { $set: { scannedDocuments: updatedDocs } },
      );

    return toRecord({
      ...(raw || {}),
      ...(updatedRaw || {}),
      scannedDocuments: updatedDocs,
    });
  }

  async applyExtractedDataToGrievance(
    recordId: string,
    docId: string,
  ): Promise<WorkspaceRecord> {
    await this.ready();
    const raw = await this.storedRecord(recordId);
    const existingDocs = (raw.scannedDocuments || raw.documents) as
      Array<Record<string, unknown>> | undefined;
    const match = Array.isArray(existingDocs)
      ? existingDocs.find((d) => String(d.id) === docId)
      : null;
    if (!match || !match.structuredData) {
      throw new BadRequestException(
        'No structured extraction data found for this document.',
      );
    }

    const data = match.structuredData as GrievanceExtractedData;
    const updateFields: Record<string, unknown> = {};

    if (data.applicantName && !text(raw.fullName)) {
      updateFields.fullName = data.applicantName;
    }
    if (data.applicantName && (!text(raw.title) || raw.title === 'Grievance')) {
      updateFields.title = data.applicantName;
    }
    if (data.contactNumber && !text(raw.contactNumber)) {
      updateFields.contactNumber = data.contactNumber;
    }
    if (data.referenceNumber && !text(raw.referenceNumber)) {
      updateFields.referenceNumber = data.referenceNumber;
    }
    if (data.date && !text(raw.dateOfVisit)) {
      updateFields.dateOfVisit = data.date;
    }
    if (data.assignedOfficer && !text(raw.assignedOfficer)) {
      updateFields.assignedOfficer = data.assignedOfficer;
    }
    if (data.village && !text(raw.village)) {
      updateFields.village = data.village;
    }
    if (data.mandal && !text(raw.mandal)) {
      updateFields.mandal = data.mandal;
    }
    if (data.division && !text(raw.division)) {
      updateFields.division = data.division;
    }
    if (data.assemblyConstituency && !text(raw.assemblyConstituency)) {
      updateFields.assemblyConstituency = data.assemblyConstituency;
    }
    if (data.actionRequested && !text(raw.actionToBeTaken)) {
      updateFields.actionToBeTaken = data.actionRequested;
    }
    if (data.issueSummary) {
      updateFields.detail = text(raw.detail)
        ? `${text(raw.detail)}\n\n[Grok AI Extracted]: ${data.issueSummary}`
        : data.issueSummary;
    }

    if (Object.keys(updateFields).length > 0) {
      const updatedRaw = await this.db
        .collection(RECORDS)
        .findOneAndUpdate({ _id: asId(recordId) }, { $set: updateFields });
      return toRecord({
        ...(raw || {}),
        ...(updatedRaw || {}),
        ...updateFields,
      });
    }

    return toRecord(raw);
  }

  async progressByToken(token: string): Promise<{
    title: string;
    detail: string;
    department: string;
    place: string;
    leader: string;
    status: string;
    stages: ProgressStage[];
    remarks: string;
    updatedAt: string;
    history: ProgressHistoryEntry[];
  }> {
    const record = await this.byToken(token);
    const row = reportOf(record);
    return {
      title: row.title,
      detail: row.detail,
      department: row.department,
      place: row.place,
      leader: row.leader,
      status: record.status,
      stages: row.stages,
      remarks: record.progressRemarks || record.remarks || '',
      updatedAt: record.progressUpdatedAt || row.updatedAt,
      history: record.progressHistory || [],
    };
  }

  async saveProgress(
    tokenOrId: string,
    input: ProgressStage[] | SaveProgressInput,
  ): Promise<WorkspaceRecord> {
    await this.ready();
    let existing: WorkspaceRecord | null = null;
    let isToken = false;
    if (/^[a-f0-9]{18}$/i.test(tokenOrId)) {
      try {
        existing = await this.byToken(tokenOrId);
        isToken = true;
      } catch {
        existing = null;
      }
    }
    if (!existing) {
      try {
        existing = await this.get(tokenOrId);
      } catch {
        existing = null;
      }
    }
    if (!existing) {
      throw new NotFoundException(
        'This progress link or grievance is no longer available',
      );
    }

    const options: SaveProgressInput = Array.isArray(input)
      ? { stages: input }
      : input || {};

    // Department authorization check
    if (options.department && options.department.trim()) {
      const authorizedDept = (
        existing.followUpDepartment ||
        existing.department ||
        ''
      )
        .trim()
        .toLowerCase();
      const claimedDept = options.department.trim().toLowerCase();
      if (authorizedDept && claimedDept !== authorizedDept) {
        throw new UnauthorizedException(
          `Department "${options.department}" is not authorized to update this record assigned to "${existing.followUpDepartment || existing.department}".`,
        );
      }
    }

    const stagesToSave: ProgressStage[] =
      options.stages && options.stages.length
        ? options.stages
        : existing.progressStages && existing.progressStages.length
          ? existing.progressStages
          : defaultStages();

    let newStatus = existing.status || 'Pending';
    if (options.status && options.status.trim()) {
      const validStatuses = [
        'Pending',
        'In progress',
        'Completed',
        'Resolved',
        'Open',
        'Reviewed',
        'Approved',
      ];
      if (!validStatuses.includes(options.status.trim())) {
        throw new BadRequestException(`Invalid status: ${options.status}`);
      }
      newStatus = options.status.trim();
    } else if (options.stages && options.stages.length) {
      const allCompleted = options.stages.every(
        (s) => s.status === 'Completed',
      );
      const anyActive = options.stages.some(
        (s) => s.status === 'In progress' || s.status === 'Completed',
      );
      if (allCompleted) newStatus = 'Completed';
      else if (anyActive) newStatus = 'In progress';
    }

    const remarks =
      typeof options.remarks === 'string'
        ? options.remarks.trim()
        : existing.progressRemarks || existing.remarks || '';
    const dept = (
      options.department ||
      existing.followUpDepartment ||
      existing.department ||
      'Department'
    ).trim();
    const now = new Date().toISOString();

    const historyEntry: ProgressHistoryEntry = {
      timestamp: now,
      status: newStatus,
      remarks,
      department: dept,
      stages: stagesToSave,
    };

    const prevHistory = existing.progressHistory || [];
    const updatedHistory = [...prevHistory, historyEntry];
    const token = existing.progressToken || randomBytes(9).toString('hex');

    const prevStages = existing.progressStages || [];
    const prevWorkStartedStage = prevStages.find(
      (s) => s.name === 'Work started' || s.name === STAGE_NAMES[0],
    );
    const prevWorkStartedStatus = prevWorkStartedStage?.status || 'Pending';

    const newWorkStartedStage = stagesToSave.find(
      (s) => s.name === 'Work started' || s.name === STAGE_NAMES[0],
    );
    const newWorkStartedStatus = newWorkStartedStage?.status || 'Pending';
    const alreadyNotified = Boolean(
      (existing as unknown as Record<string, unknown>).workStartedNotifiedAt,
    );
    const workJustStarted =
      !alreadyNotified &&
      prevWorkStartedStatus === 'Pending' &&
      newWorkStartedStatus === 'In progress';

    const patch: Record<string, unknown> = {
      status: newStatus,
      resolutionStatus: newStatus,
      progressStages: stagesToSave,
      progressUpdatedAt: now,
      progressRemarks: remarks,
      remarks,
      progressHistory: updatedHistory,
      progressToken: token,
      ...(options.department ? { followUpDepartment: dept } : {}),
    };

    const filter = isToken
      ? { progressToken: tokenOrId }
      : { _id: asId(existing.id) };

    const saved = await this.db
      .collection(RECORDS)
      .findOneAndUpdate(filter, { $set: patch });
    if (!saved)
      throw new NotFoundException('This progress link is no longer available');

    if (workJustStarted) {
      const raiser = whatsappNumber(
        existing.contactNumber ||
          text((existing as unknown as Record<string, unknown>).reporterPhone),
      );
      const notice = await notifyWorkStarted(raiser, {
        reference: existing.srNumber || existing.id,
        title: existing.title || existing.detail,
        location: existing.place || existing.village,
        department: dept,
        token,
      });
      await this.db.collection(RECORDS).findOneAndUpdate(filter, {
        $set: {
          ...(notice.accepted ? { workStartedNotifiedAt: now } : {}),
          workStartedNotice: notice,
        },
      });
    }

    return await this.get(existing.id);
  }

  async reportFile(id: string): Promise<{ name: string; bytes: Buffer }> {
    const row = reportOf(await this.get(id));
    return { name: fileName(row.title, 'pdf'), bytes: reportPdf(row) };
  }

  async reportBundle(
    section: 'grievances' | 'projects',
    format: 'pdf' | 'xlsx',
  ): Promise<{ name: string; type: string; bytes: Buffer }> {
    await this.ready();
    const rows = (await this.list(section))
      .filter((row) => !row.id.startsWith('demo-'))
      .map((row) => reportOf(row));
    if (format === 'xlsx') {
      return {
        name: `${section}-reports.xlsx`,
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        bytes: await recordsWorkbook(rows),
      };
    }
    return {
      name: `${section}-reports.pdf`,
      type: 'application/pdf',
      bytes: combinedPdf(rows),
    };
  }

  private async byToken(token: string): Promise<WorkspaceRecord> {
    await this.ready();
    if (!/^[a-f0-9]{18}$/i.test(token))
      throw new NotFoundException('This progress link is no longer available');
    const doc = await this.db
      .collection(RECORDS)
      .findOne({ progressToken: token });
    if (!doc || isDemoDoc(doc))
      throw new NotFoundException('This progress link is no longer available');
    return toRecord(doc);
  }

  async summary(): Promise<{
    counts: Record<WorkspaceSection, number>;
    open: number;
    news: number;
    mongo: boolean;
  }> {
    await this.ready();
    const counts = {} as Record<WorkspaceSection, number>;
    for (const section of WORKSPACE_SECTIONS) {
      counts[section] = await this.db
        .collection(RECORDS)
        .countDocuments({ section });
    }
    const open = await this.db
      .collection(RECORDS)
      .countDocuments({ status: { $in: ['Open', 'Pending', 'In progress'] } });
    let news = 0;
    try {
      news = await this.db
        .collection(this.db.articlesCollectionName)
        .countDocuments({});
    } catch {
      news = 0;
    }
    return { counts, open, news, mongo: true };
  }

  private async ready(): Promise<void> {
    const ok = await this.db.ensureConnected();
    if (!ok) throw new ServiceUnavailableException('Database is not connected');
  }

  private secret(): string {
    return (
      this.config.get<string>('admin.sessionSecret') ||
      'mediasphere-admin-dev-insecure'
    );
  }

  private sign(userId: string): string {
    const exp = Math.floor(Date.now() / 1000) + 60 * 60 * 12;
    const payload = `${userId}.${exp}`;
    const sig = createHmac('sha256', this.secret())
      .update(`jv:${payload}`)
      .digest('hex');
    return `${payload}.${sig}`;
  }

  verify(token: string): string {
    const parts = token.split('.');
    if (parts.length !== 3) throw new UnauthorizedException('Session expired');
    const [userId, exp, sig] = parts;
    const expected = createHmac('sha256', this.secret())
      .update(`jv:${userId}.${exp}`)
      .digest('hex');
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b))
      throw new UnauthorizedException('Session expired');
    if (Number(exp) < Math.floor(Date.now() / 1000))
      throw new UnauthorizedException('Session expired');
    return userId;
  }
}

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 32).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const next = scryptSync(password, salt, 32);
  const prev = Buffer.from(hash, 'hex');
  if (next.length !== prev.length) return false;
  return timingSafeEqual(next, prev);
}

/**
 * Dispatches action request to the department.
 * Prioritizes native WhatsApp interactive buttons so the department user can
 * manage the grievance entirely inside WhatsApp without external links.
 */
function clean(value: string): string {
  return (
    value
      .replace(/[\r\n\t]+/g, ' ')
      .replace(/ {2,}/g, ' ')
      .trim()
      .slice(0, 200) || '—'
  );
}

export interface DepartmentRecipient {
  phone: string;
  source: string;
  required: boolean;
}

function leaderPhoneSet(): Set<string> {
  const names = [GENERAL_DESK.leader, ...DESKS.map((desk) => desk.leader)];
  const phones = new Set<string>();
  for (const name of names) {
    const found = phoneForName(name);
    const phone = found ? whatsappNumber(found) : '';
    if (phone) phones.add(phone);
  }
  return phones;
}

/**
 * Department inbox first. Assigned officer and directory matches are extra.
 * Leader numbers and the grievance lead phone are never included.
 */
export function resolveDepartmentRecipients(
  desk: { department: string; place: string; leader: string },
  record?: WorkspaceRecord,
  env: NodeJS.ProcessEnv = process.env,
): DepartmentRecipient[] {
  const leaders = leaderPhoneSet();
  const chosen = new Map<string, DepartmentRecipient>();
  const add = (raw: string, source: string, required: boolean) => {
    const phone = whatsappNumber(raw);
    if (!phone || leaders.has(phone)) return;
    const current = chosen.get(phone);
    if (!current) {
      chosen.set(phone, { phone, source, required });
      return;
    }
    if (required) current.required = true;
  };

  const configuredInbox = (env.DEPARTMENT_WHATSAPP || '').trim();
  const inbox = whatsappNumber(configuredInbox || DEPARTMENT_WHATSAPP);
  if (inbox) {
    add(
      inbox,
      configuredInbox ? 'DEPARTMENT_WHATSAPP' : 'department_inbox',
      true,
    );
  }

  if (record?.assignedOfficer) {
    const officer = phoneForName(record.assignedOfficer);
    if (officer) add(officer, 'assigned_officer', false);
  }

  const deptName =
    record?.followUpDepartment || record?.department || desk.department;
  if (deptName) {
    const match = phoneForName(deptName);
    if (match) add(match, 'department_directory', false);
  }

  for (const item of (env.DEPARTMENT_PHONES || '').split(',')) {
    add(item, 'DEPARTMENT_PHONES', false);
  }

  return [...chosen.values()];
}

function metaAccepted(result: unknown): {
  ok: boolean;
  messageId: string | null;
} {
  if (!result || typeof result !== 'object')
    return { ok: false, messageId: null };
  const body = result as Record<string, unknown>;
  const messages = body.messages;
  if (Array.isArray(messages) && messages.length) {
    const id = (messages[0] as Record<string, unknown>).id;
    if (id) return { ok: true, messageId: String(id) };
  }
  if (body.success === true) return { ok: true, messageId: null };
  return { ok: false, messageId: null };
}

/** Approved dynamic template already on this WhatsApp account. Do not add another. */
const APPROVED_DYNAMIC_TEMPLATE = 'jv_mp_action_request';

async function notifyWorkStarted(
  phone: string,
  detail: {
    reference: string;
    title: string;
    location: string;
    department: string;
    token: string;
  },
): Promise<Record<string, unknown>> {
  const logger = new Logger('WorkStartedNotice');
  const tail = phone ? phone.slice(-4) : 'none';
  if (!phone) {
    const missing = {
      accepted: false,
      recipientTail: tail,
      channel: 'none',
      error: 'raiser WhatsApp number is missing',
      at: new Date().toISOString(),
    };
    logger.warn('Work-started notice skipped: raiser number is missing');
    await recordOutboundAttempt({
      accepted: false,
      error: String(missing.error),
      notificationType: 'work_started',
    });
    return missing;
  }
  const reference = clean(
    `${detail.reference || 'your request'}${detail.location ? ` - ${detail.location}` : ''}`,
  );
  try {
    const sent = await sendTemplateMessage(phone, APPROVED_DYNAMIC_TEMPLATE, {
      language: 'en',
      bodyParameters: [
        clean(detail.department || 'Department'),
        clean(detail.title || detail.reference || 'your grievance'),
        reference,
        'Work Started',
      ],
      urlButton: detail.token ? `progress/${detail.token}` : undefined,
    });
    const accepted = metaAccepted(sent);
    if (!accepted.ok)
      throw new Error('Meta did not accept the approved dynamic template');
    await recordOutboundAttempt({
      accepted: true,
      messageId: accepted.messageId,
      notificationType: 'work_started',
      httpCode: 200,
    });
    logger.log(`Work-started template accepted for ${tail}`);
    return {
      accepted: true,
      recipientTail: tail,
      channel: 'template',
      messageId: accepted.messageId,
      error: null,
      at: new Date().toISOString(),
    };
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'send failed';
    logger.warn(`Work-started notice failed for ${tail}: ${reason}`);
    await recordOutboundAttempt({
      accepted: false,
      error: reason,
      notificationType: 'work_started',
    });
    return {
      accepted: false,
      recipientTail: tail,
      channel: 'template',
      error: reason.slice(0, 300),
      at: new Date().toISOString(),
    };
  }
}

async function sendDepartmentActionNotice(
  desk: { department: string; place: string; leader: string },
  issue: string,
  recordId: string,
  token: string,
  record?: WorkspaceRecord,
  env: NodeJS.ProcessEnv = process.env,
): Promise<boolean> {
  const logger = new Logger('DepartmentNotice');
  const when = new Date().toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Kolkata',
  });

  const bodyText =
    `📋 *UPDATE WORK PROGRESS*\n\n` +
    `*Department:* ${clean(desk.department)}\n` +
    `*Work:* ${clean(issue)}\n` +
    `*Location:* ${clean(desk.place)}\n` +
    `*Date:* ${when}\n\n` +
    `Use the menu below to update the progress of this work.`;

  const buttons: ReplyButton[] = [
    { id: `dept:g:up_pick:${recordId}`, title: 'Update Progress' },
    { id: `dept:g:pick:${recordId}`, title: 'View Details' },
    { id: 'dept:menu', title: 'Department Menu' },
  ];

  const recipients = resolveDepartmentRecipients(desk, record, env);
  if (!recipients.some((item) => item.required)) {
    throw new Error('Department WhatsApp number is missing or invalid.');
  }
  let requiredAccepted = false;
  let usedInteractive = false;
  let lastError: unknown = null;

  for (const recipient of recipients) {
    logger.log(
      `Department notice source=${recipient.source} tail=${recipient.phone.slice(-4)} required=${recipient.required}`,
    );
    try {
      const sent = await sendReplyButtons(
        recipient.phone,
        bodyText,
        buttons,
        fetch,
        env,
      );
      const accepted = metaAccepted(sent);
      if (!accepted.ok) {
        throw new Error(
          'Meta did not accept the interactive department message',
        );
      }
      await recordOutboundAttempt({
        accepted: true,
        messageId: accepted.messageId,
        httpCode: 200,
        notificationType: 'department_approval',
      });
      if (recipient.required) {
        requiredAccepted = true;
        usedInteractive = true;
      }
      continue;
    } catch (interactiveErr) {
      try {
        const sent = await sendTemplateMessage(
          recipient.phone,
          APPROVED_DYNAMIC_TEMPLATE,
          {
            language: 'en',
            bodyParameters: [
              clean(desk.department),
              clean(issue),
              clean(`${desk.place} - ${desk.department}`),
              when,
            ],
            urlButton: `progress/${token}`,
            env,
          },
        );
        const accepted = metaAccepted(sent);
        if (!accepted.ok) {
          throw new Error('Meta did not accept the department template');
        }
        await sendQuiet(
          recipient.phone,
          `📲 *Native WhatsApp Operations Menu*\n\n` +
            `Reply *MENU* or *OPERATIONS* at any time to open the Department Operations Menu directly in WhatsApp.`,
        );
        await recordOutboundAttempt({
          accepted: true,
          messageId: accepted.messageId,
          httpCode: 200,
          notificationType: 'department_approval',
        });
        if (recipient.required) requiredAccepted = true;
      } catch (err) {
        lastError = err || interactiveErr;
        const reason = err instanceof Error ? err.message : 'send failed';
        logger.warn(
          `Department notice failed source=${recipient.source} tail=${recipient.phone.slice(-4)}: ${reason}`,
        );
        await recordOutboundAttempt({
          accepted: false,
          error: reason,
          notificationType: 'department_approval',
        });
      }
    }
  }

  if (!requiredAccepted) {
    const reason =
      lastError instanceof Error
        ? lastError.message
        : 'The department WhatsApp number did not accept the notification.';
    throw new Error(reason);
  }
  return usedInteractive;
}

/** Backward-compatible alias */
async function sendDepartmentLink(
  desk: { department: string; place: string; leader: string },
  issue: string,
  token: string,
  recordId?: string,
): Promise<void> {
  await sendDepartmentActionNotice(desk, issue, recordId || '', token);
}

function whatsappNumber(value: string): string {
  const digits = value.replace(/\D/g, '');
  if (digits.length === 10) return `91${digits}`;
  if (digits.length >= 8 && digits.length <= 15) return digits;
  return '';
}

async function sendQuiet(phone: string, body: string): Promise<boolean> {
  try {
    await sendTextMessage(phone, body);
    return true;
  } catch {
    return false;
  }
}

function asId(id: string): ObjectId | string {
  return ObjectId.isValid(id) && String(new ObjectId(id)) === id
    ? new ObjectId(id)
    : id;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function simpleStored(
  input: { title?: string; detail?: string; status?: string } & CaseInput,
): Record<string, unknown> {
  return {
    title: (input.title || '').trim(),
    detail: (input.detail || '').trim(),
    status: input.status || 'Open',
    place: input.place || '',
    visitDate: input.visitDate || '',
    visitTime: input.visitTime || '',
    leadPhone: input.leadPhone || '',
  };
}

function storedCase(input: CaseInput): Record<string, unknown> {
  const categories = input.categories || [];
  const place = [
    input.village,
    input.mandal,
    input.division,
    input.assemblyConstituency,
  ]
    .filter(Boolean)
    .join(', ');
  return {
    title: (input.fullName || '').trim(),
    detail: caseDetail(input),
    status: input.resolutionStatus || 'Open',
    srNumber: input.srNumber || '',
    fullName: input.fullName || '',
    contactNumber: input.contactNumber || '',
    address: input.address || '',
    email: input.email || '',
    village: input.village || '',
    mandal: input.mandal || '',
    division: input.division || '',
    assemblyConstituency: input.assemblyConstituency || '',
    dateOfVisit: input.dateOfVisit || '',
    referenceName: input.referenceName || '',
    referenceNumber: input.referenceNumber || '',
    categories,
    others: categories.includes('Others') ? input.others || '' : '',
    actionTaken: input.actionTaken || '',
    actionToBeTaken: input.actionToBeTaken || '',
    assignedOfficer: input.assignedOfficer || '',
    resolutionStatus: input.resolutionStatus || '',
    deadline: input.deadline || '',
    place,
    visitDate: input.dateOfVisit || '',
  };
}

function caseDetail(input: CaseInput): string {
  const picked = (input.categories || []).filter((item) => item !== 'Others');
  if (input.categories?.includes('Others') && input.others)
    picked.push(input.others);
  return [
    picked.join(', '),
    input.actionToBeTaken ? `Action to be taken: ${input.actionToBeTaken}` : '',
  ]
    .filter(Boolean)
    .join('. ');
}

function toRecord(doc: Record<string, unknown>): WorkspaceRecord {
  const categories = Array.isArray(doc.categories)
    ? doc.categories.map((item) => String(item))
    : [];
  return {
    id: String(doc._id),
    section: doc.section as WorkspaceSection,
    title: String(doc.title || ''),
    detail: String(doc.detail || ''),
    status: String(doc.status || 'Open'),
    date:
      text(doc.dateOfVisit) ||
      text(doc.visitDate) ||
      String(doc.createdAt || ''),
    createdBy: String(doc.createdBy || ''),
    followUpDepartment: text(doc.followUpDepartment) || text(doc.department),
    srNumber: text(doc.srNumber),
    fullName: text(doc.fullName),
    contactNumber: text(doc.contactNumber),
    address: text(doc.address),
    email: text(doc.email),
    village: text(doc.village),
    mandal: text(doc.mandal),
    division: text(doc.division),
    assemblyConstituency: text(doc.assemblyConstituency),
    dateOfVisit: text(doc.dateOfVisit),
    referenceName: text(doc.referenceName),
    referenceNumber: text(doc.referenceNumber),
    categories,
    others: text(doc.others),
    actionTaken: text(doc.actionTaken),
    actionToBeTaken: text(doc.actionToBeTaken),
    assignedOfficer: text(doc.assignedOfficer),
    resolutionStatus: text(doc.resolutionStatus),
    deadline: text(doc.deadline),
    place: text(doc.place),
    visitDate: text(doc.visitDate) || text(doc.dateOfVisit),
    visitTime: text(doc.visitTime),
    leadPhone: text(doc.leadPhone),
    progressToken: text(doc.progressToken),
    progressStages: stagesOf(doc.progressStages),
    progressUpdatedAt: text(doc.progressUpdatedAt),
    progressRemarks: text(doc.progressRemarks || doc.remarks),
    remarks: text(doc.remarks || doc.progressRemarks),
    progressHistory: historyOf(doc.progressHistory),
    workStartedNotifiedAt: text(doc.workStartedNotifiedAt),
    scannedDocuments: documentsOf(doc.scannedDocuments || doc.documents),
    ...deskFields(doc),
  };
}

function historyOf(value: unknown): ProgressHistoryEntry[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const entry = item as Record<string, unknown>;
    const timestamp = text(entry.timestamp);
    const status = text(entry.status);
    if (!timestamp && !status) return [];
    return [
      {
        timestamp: timestamp || new Date().toISOString(),
        status: status || 'Pending',
        remarks: text(entry.remarks),
        department: text(entry.department),
        stages: stagesOf(entry.stages),
      },
    ];
  });
}

function deskFields(doc: Record<string, unknown>): {
  department: string;
  leader: string;
} {
  const section = String(doc.section || '');
  if (section !== 'grievances' && section !== 'projects')
    return { department: '', leader: '' };
  const desk = assignDesk(
    `${text(doc.title)} ${text(doc.detail)} ${text(doc.village)} ${text(doc.place)}`,
  );
  return {
    department:
      text(doc.followUpDepartment) || text(doc.department) || desk.department,
    leader: desk.leader,
  };
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

function reportOf(record: WorkspaceRecord): ReportRow {
  const issue = record.detail || record.title;
  const desk = assignDesk(
    `${record.title} ${record.detail} ${record.village} ${record.place}`,
  );
  return {
    title: record.fullName || record.title,
    detail: issue,
    status: record.status,
    department: record.followUpDepartment || desk.department,
    place:
      [record.village, record.mandal, record.assemblyConstituency]
        .filter(Boolean)
        .join(', ') ||
      record.place ||
      desk.place,
    leader: desk.leader,
    officer: record.assignedOfficer,
    action: record.actionToBeTaken,
    deadline: record.deadline,
    stages: record.progressStages.length
      ? record.progressStages
      : defaultStages(),
    updatedAt: record.progressUpdatedAt,
  };
}

function fileName(title: string, extension: string): string {
  const slug =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || 'report';
  return `${slug}.${extension}`;
}

function documentsOf(value: unknown): GrievanceDocument[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const doc = item as Record<string, unknown>;
    const id = text(doc.id);
    if (!id) return [];
    const status =
      doc.status === 'completed' ||
      doc.status === 'failed' ||
      doc.status === 'processing'
        ? doc.status
        : 'completed';
    return [
      {
        id,
        filename: text(doc.filename) || 'document',
        mimeType: text(doc.mimeType) || 'application/octet-stream',
        sizeBytes: Number(doc.sizeBytes) || 0,
        uploadedAt: text(doc.uploadedAt) || new Date().toISOString(),
        status,
        extractedText: text(doc.extractedText),
        structuredData: doc.structuredData as
          GrievanceExtractedData | undefined,
        errorMessage: text(doc.errorMessage),
      },
    ];
  });
}
