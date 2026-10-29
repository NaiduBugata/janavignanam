import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { whatsappSenderReady } from '../birthdays/birthdays';
import { calendarDay } from '../reports/report-stats';
import { sendTemplateMessage } from '../whatsapp/whatsapp.send';
import {
  FOLLOW_UP_TEMPLATE,
  followUpParameters,
  listedPhones,
  reminderPlan,
  type FollowUpVisit,
} from './visit-followup';

const RECORDS = 'jv_records';
const ZONE = 'Asia/Kolkata';
/** One stuck WhatsApp call must not hold the rest of the follow-ups. */
const SEND_TIMEOUT_MS = 20_000;

function limitedFetch(fetchImpl: typeof fetch): typeof fetch {
  return async (input, init) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);
    try {
      return await fetchImpl(input, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  };
}

export interface FollowUpResult {
  due: number;
  sent: number;
  failed: number;
}

interface StoredVisit extends FollowUpVisit {
  rawId: unknown;
  pendingSlot?: string;
}

@Injectable()
export class VisitFollowupService {
  private readonly logger = new Logger(VisitFollowupService.name);

  constructor(private readonly db: DatabaseService) {}

  /** Every lead for visits scheduled today. The MP asked, so this sends even when the morning reminder already went. */
  async sendToday(
    fetchImpl: typeof fetch = fetch,
    now = new Date(),
  ): Promise<FollowUpResult> {
    const today = calendarDay(now, ZONE);
    const visits = (await this.load()).filter(
      (visit) => visit.visitDate === today && listedPhones(visit).length,
    );
    return this.deliver(visits, fetchImpl, false);
  }

  /** True when a Follow up tap has at least one number to message. The chat answers before those messages go out. */
  async readyToSend(): Promise<boolean> {
    if (!whatsappSenderReady()) return false;
    const visits = await this.load();
    return visits.some((visit) => listedPhones(visit).length > 0);
  }

  /** Every saved visit, every tap. Nothing is marked, so Follow up can be sent again. */
  async sendAll(fetchImpl: typeof fetch = fetch): Promise<FollowUpResult> {
    const visits = (await this.load()).filter(
      (visit) => listedPhones(visit).length,
    );
    return this.deliver(visits, fetchImpl, false);
  }

  /** Up to three reminders before the visit, only to the numbers allotted to that visit. */
  async sendDue(
    fetchImpl: typeof fetch = fetch,
    now = new Date(),
  ): Promise<FollowUpResult> {
    const visits = await this.load();
    const due: StoredVisit[] = [];
    for (const visit of visits) {
      const plan = reminderPlan(visit, now);
      if (plan.skip.length) await this.markSlots(visit, plan.skip);
      if (!plan.send) continue;
      visit.pendingSlot = plan.send.id;
      due.push(visit);
    }
    return this.deliver(due, fetchImpl, true);
  }

  private async deliver(
    visits: StoredVisit[],
    fetchImpl: typeof fetch,
    mark: boolean,
  ): Promise<FollowUpResult> {
    const jobs = visits.flatMap((visit) =>
      listedPhones(visit).map((phone) => ({ visit, phone })),
    );
    if (!jobs.length || !whatsappSenderReady()) {
      return {
        due: jobs.length,
        sent: 0,
        failed: jobs.length && !whatsappSenderReady() ? jobs.length : 0,
      };
    }
    let sent = 0;
    let failed = 0;
    const failedIds = new Set<string>();
    const limited = limitedFetch(fetchImpl);
    for (const job of jobs) {
      try {
        await sendTemplateMessage(job.phone, FOLLOW_UP_TEMPLATE, {
          language: 'en',
          namedParameters: followUpParameters(job.visit),
          fetchImpl: limited,
        });
        sent += 1;
      } catch (err) {
        failed += 1;
        failedIds.add(job.visit.id);
        this.logger.warn(
          `Visit follow-up was not accepted: ${err instanceof Error ? err.message : 'send failed'}`,
        );
      }
    }
    if (mark) {
      for (const visit of visits) {
        if (
          !visit.pendingSlot ||
          !listedPhones(visit).length ||
          failedIds.has(visit.id)
        )
          continue;
        await this.markSlots(visit, [visit.pendingSlot]);
      }
    }
    return { due: jobs.length, sent, failed };
  }

  private async load(): Promise<StoredVisit[]> {
    if (!(await this.db.ensureConnected())) return [];
    const rows = await this.db
      .collection(RECORDS)
      .find({ section: 'visits' })
      .toArray();
    return rows.map((row) => ({
      id: String(row._id),
      rawId: row._id,
      title: String(row.title || ''),
      place: String(row.place || ''),
      visitDate: String(row.visitDate || ''),
      visitTime: String(row.visitTime || ''),
      leadPhone: String(row.leadPhone || ''),
      leadPhones: Array.isArray(row.leadPhones)
        ? row.leadPhones.map((phone) => String(phone || ''))
        : [],
      followUpAutoDay: String(row.followUpAutoDay || ''),
      followUpSent: Array.isArray(row.followUpSent)
        ? row.followUpSent.map((slot) => String(slot || '')).filter(Boolean)
        : [],
    }));
  }

  private async markSlots(visit: StoredVisit, slots: string[]): Promise<void> {
    const followUpSent = [
      ...new Set([...(visit.followUpSent || []), ...slots]),
    ];
    visit.followUpSent = followUpSent;
    await this.db
      .collection(RECORDS)
      .updateOne({ _id: visit.rawId }, { $set: { followUpSent } });
  }
}
