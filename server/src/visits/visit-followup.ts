/** India has no daylight-saving time. */
const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export const FOLLOW_UP_TEMPLATE = 'visit_followup_en';
export const FOLLOW_UP_SENT = 'Follow-up message sent successfully.';
/** A visit with no clock time is reminded at these hours on the visit day. */
const ANYTIME_MINUTES = [7 * 60, 12 * 60, 16 * 60];
/** Hours before a timed visit. Three is the most that go out. */
const TIMED_LEAD_HOURS = [3, 2, 1];

export interface FollowUpVisit {
  id: string;
  title: string;
  place: string;
  visitDate: string;
  visitTime: string;
  leadPhone: string;
  /** Extra follow-up numbers. A visit can message more than one person. */
  leadPhones?: string[];
  followUpAutoDay: string;
  /** Reminder slots already sent or skipped for this visit. */
  followUpSent?: string[];
}

export interface ReminderSlot {
  id: string;
  at: Date;
}

/** Every distinct mobile on the visit. The same number is not messaged twice. */
export function listedPhones(
  visit: Pick<FollowUpVisit, 'leadPhone' | 'leadPhones'>,
): string[] {
  const seen = new Set<string>();
  const phones: string[] = [];
  for (const value of [...(visit.leadPhones || []), visit.leadPhone || '']) {
    const digits = String(value || '').replace(/\D/g, '');
    if (digits.length < 10 || seen.has(digits)) continue;
    seen.add(digits);
    phones.push(digits);
  }
  return phones;
}

/** Up to three times before the visit. A timed visit is 3, 2, and 1 hour before. Anytime is 7:00 AM, 12:00 PM, and 4:00 PM. */
export function reminderSlots(
  visitDate: string,
  visitTime: string,
): ReminderSlot[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(visitDate)) return [];
  const start = firstMinutes(visitTime);
  if (start === null) {
    return ANYTIME_MINUTES.map((minutes) => ({
      id: `${visitDate}@${minutes}`,
      at: istDate(visitDate, minutes),
    }));
  }
  return TIMED_LEAD_HOURS.map((hours) => {
    const shifted = start - hours * 60;
    const day = shifted < 0 ? shiftDay(visitDate, -1) : visitDate;
    const minutes = shifted < 0 ? shifted + 24 * 60 : shifted;
    return { id: `${day}@${minutes}`, at: istDate(day, minutes) };
  });
}

/** The next reminder to send, plus earlier missed slots that should not be sent late. */
export function reminderPlan(
  visit: FollowUpVisit,
  now: Date,
): { send: ReminderSlot | null; skip: string[] } {
  const none = { send: null, skip: [] as string[] };
  if (!listedPhones(visit).length || !visit.visitDate) return none;
  const sent = new Set(visit.followUpSent || []);
  if (visit.followUpAutoDay === visit.visitDate && sent.size === 0) return none;
  const cutoff = eventCutoff(visit.visitDate, visit.visitTime);
  if (!cutoff || now.getTime() >= cutoff.getTime()) return none;
  const due = reminderSlots(visit.visitDate, visit.visitTime).filter(
    (slot) => !sent.has(slot.id) && now.getTime() >= slot.at.getTime(),
  );
  if (!due.length) return none;
  return {
    send: due[due.length - 1],
    skip: due.slice(0, -1).map((slot) => slot.id),
  };
}

export function followUpParameters(
  visit: Pick<FollowUpVisit, 'title' | 'place' | 'visitTime'>,
): Record<string, string> {
  return {
    title: templateValue(visit.title, 'Scheduled visit'),
    place: templateValue(visit.place, 'as scheduled'),
    time: templateValue(displayTime(visit.visitTime), 'Anytime'),
  };
}

function templateValue(value: string, fallback: string): string {
  const cleaned = value
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/ {4,}/g, '   ')
    .trim()
    .slice(0, 1024);
  return cleaned || fallback;
}

function displayTime(value: string): string {
  return value
    .split('-')
    .map((part) => {
      const match = part.match(/^(\d{2}):(\d{2})$/);
      if (!match) return '';
      const hour = Number(match[1]);
      return `${hour % 12 || 12}:${match[2]} ${hour < 12 ? 'AM' : 'PM'}`;
    })
    .filter(Boolean)
    .join(' - ');
}

function eventCutoff(visitDate: string, visitTime: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(visitDate)) return null;
  const start = firstMinutes(visitTime);
  if (start === null) return istDate(shiftDay(visitDate, 1), 0);
  return istDate(visitDate, start);
}

function firstMinutes(visitTime: string): number | null {
  const match = visitTime.match(/^(\d{2}):(\d{2})/);
  if (!match) return null;
  const minutes = Number(match[1]) * 60 + Number(match[2]);
  return minutes >= 0 && minutes < 24 * 60 ? minutes : null;
}

function shiftDay(iso: string, days: number): string {
  const [year, month, day] = iso.split('-').map(Number);
  const utc = new Date(Date.UTC(year, month - 1, day) + days * DAY_MS);
  return utc.toISOString().slice(0, 10);
}

function istDate(isoDay: string, minutes: number): Date {
  const [year, month, day] = isoDay.split('-').map(Number);
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  return new Date(Date.UTC(year, month - 1, day, hour, minute) - IST_OFFSET_MS);
}
