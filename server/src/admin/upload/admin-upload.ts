import { BadRequestException } from '@nestjs/common';
import {
  normalizeContactPhone,
  parseBirthday,
} from '../../birthdays/birthdays';
import { parseVisitTime } from '../../visits/visits-import';

export const UPLOAD_KINDS = [
  'visits',
  'schedule',
  'campaigns',
  'grievances',
  'projects',
  'constituency',
  'leaders',
  'birthdays',
] as const;

export type UploadKind = (typeof UPLOAD_KINDS)[number];

const STATUSES = new Set(['Open', 'In progress', 'Closed']);

type Spec = {
  headers: string[];
  example: string[];
};

export const UPLOAD_SPECS: Record<UploadKind, Spec> = {
  visits: {
    headers: [
      'Date (DD-MM-YYYY)',
      'Time (10:30 AM)',
      'Place',
      'Purpose / Title',
      'Details',
      'Lead phone (optional)',
    ],
    example: [
      '29-09-2026',
      '10:30 AM',
      'Narasaraopet',
      'Hospital visit',
      'Met the staff',
      '9876543210',
    ],
  },
  schedule: {
    headers: [
      'Date (DD-MM-YYYY)',
      'Time (10:30 AM or Anytime)',
      'Place',
      'Title',
      'Details',
    ],
    example: [
      '11-10-2026',
      'Anytime',
      'Vinukonda',
      'Ward meeting',
      'Evening round',
    ],
  },
  campaigns: {
    headers: ['Title', 'Details', 'Status'],
    example: ['Door to door', 'Narasaraopet ward visits this week', 'Open'],
  },
  grievances: {
    headers: ['Title', 'Details', 'Status', 'Priority'],
    example: [
      'No drinking water',
      'Vinukonda colony has had no water',
      'Open',
      'high',
    ],
  },
  projects: {
    headers: ['Title', 'Details', 'Status'],
    example: [
      'School building',
      'Roof work at the primary school',
      'In progress',
    ],
  },
  constituency: {
    headers: ['Name', 'Place', 'Designation', 'Details', 'Phone'],
    example: [
      'Ravi Kumar',
      'Chilakaluripet',
      'Coordinator',
      'Ward 4 contact',
      '9876543210',
    ],
  },
  leaders: {
    headers: ['Name', 'Phone', 'Place', 'Designation', 'Notes'],
    example: [
      'Lakshmi',
      '9876543210',
      'Sattenapalle',
      'Leader',
      'Files grievances on WhatsApp',
    ],
  },
  birthdays: {
    headers: [
      'Name',
      'Phone',
      'Birthday (DD-MM or DD-MM-YYYY)',
      'Place',
      'Designation',
      'Notes',
      'Language (en or te)',
    ],
    example: [
      'Akshay Guptha',
      '9876543210',
      '07-10',
      'Narasaraopet',
      'Admin',
      '',
      'en',
    ],
  },
};

export type UploadRow =
  | {
      kind: 'visit';
      title: string;
      place: string;
      visitDate: string;
      visitTime: string;
      detail: string;
      leadPhone: string;
    }
  | {
      kind: 'record';
      section: 'campaigns' | 'grievances' | 'projects' | 'people';
      title: string;
      detail: string;
      status: string;
      priority?: 'high' | 'normal';
    }
  | {
      kind: 'contact';
      role: 'user' | 'person';
      name: string;
      phone: string;
      birthday: string;
      birthYear: number | null;
      place: string;
      designation: string;
      notes: string;
      language: 'en' | 'te';
    };

export type UploadParse =
  { ok: true; rows: UploadRow[] } | { ok: false; errors: string[] };

export function isUploadKind(value: string): value is UploadKind {
  return (UPLOAD_KINDS as readonly string[]).includes(value);
}

export function templateCsv(kind: UploadKind): string {
  const spec = UPLOAD_SPECS[kind];
  return `${spec.headers.join(',')}\n${spec.example.map(csvCell).join(',')}\n`;
}

export function parseUpload(kind: UploadKind, grid: string[][]): UploadParse {
  if (!grid.length) return { ok: false, errors: ['The file is empty.'] };
  const expected = UPLOAD_SPECS[kind].headers;
  const header = grid[0].map((cell) => cell.trim());
  if (
    header.length !== expected.length ||
    expected.some((name, index) => header[index] !== name)
  ) {
    return {
      ok: false,
      errors: [`The header row must be: ${expected.join(', ')}`],
    };
  }
  const body = grid.slice(1).filter((row) => row.some((cell) => cell.trim()));
  if (!body.length)
    return { ok: false, errors: ['The file has no data rows.'] };
  const errors: string[] = [];
  const rows: UploadRow[] = [];
  const phones = new Set<string>();
  body.forEach((row, index) => {
    const line = index + 2;
    const cells = expected.map((_, cell) => (row[cell] || '').trim());
    const parsed = parseRow(kind, cells, line);
    if (parsed.error) {
      errors.push(parsed.error);
      return;
    }
    if (parsed.row.kind === 'contact') {
      if (phones.has(parsed.row.phone))
        errors.push(`Row ${line}: Phone is repeated in this file.`);
      phones.add(parsed.row.phone);
    }
    rows.push(parsed.row);
  });
  if (errors.length) return { ok: false, errors };
  return { ok: true, rows };
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const src = text
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(cell.trim());
      cell = '';
    } else if (ch === '\n') {
      row.push(cell.trim());
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell.length || row.length) {
    row.push(cell.trim());
    rows.push(row);
  }
  return rows.filter((cells) => cells.some((value) => value !== ''));
}

function parseRow(
  kind: UploadKind,
  cells: string[],
  line: number,
): { row: UploadRow; error?: string } {
  try {
    if (kind === 'visits' || kind === 'schedule')
      return { row: visitRow(kind, cells) };
    if (kind === 'campaigns' || kind === 'projects')
      return { row: recordRow(kind, cells) };
    if (kind === 'grievances') return { row: grievanceRow(cells) };
    if (kind === 'constituency') return { row: constituencyRow(cells) };
    if (kind === 'leaders') return { row: contactRow('person', cells, false) };
    return { row: contactRow('user', cells, true) };
  } catch (err) {
    const message =
      err instanceof BadRequestException
        ? messageOf(err)
        : 'This row does not match the template.';
    return { row: blankRow(kind), error: `Row ${line}: ${message}` };
  }
}

function visitRow(kind: 'visits' | 'schedule', cells: string[]): UploadRow {
  const [date, time, place, title, detail, phone] =
    kind === 'visits'
      ? cells
      : [cells[0], cells[1], cells[2], cells[3], cells[4], ''];
  if (!title)
    throw new BadRequestException(
      kind === 'visits' ? 'Purpose / Title is required.' : 'Title is required.',
    );
  const visitDate = requireDay(date);
  const visitTime = visitClock(time);
  return {
    kind: 'visit',
    title: title.slice(0, 200),
    place: place.slice(0, 120),
    visitDate,
    visitTime,
    detail: detail.slice(0, 2000),
    leadPhone: phone ? normalizeContactPhone(phone) : '',
  };
}

function recordRow(
  section: 'campaigns' | 'projects',
  cells: string[],
): UploadRow {
  const [title, detail, status] = cells;
  if (!title) throw new BadRequestException('Title is required.');
  return {
    kind: 'record',
    section,
    title: title.slice(0, 200),
    detail: detail.slice(0, 2000),
    status: requireStatus(status),
  };
}

function grievanceRow(cells: string[]): UploadRow {
  const [title, detail, status, priority] = cells;
  if (!title) throw new BadRequestException('Title is required.');
  if (priority !== 'high' && priority !== 'normal')
    throw new BadRequestException('Priority must be high or normal.');
  return {
    kind: 'record',
    section: 'grievances',
    title: title.slice(0, 200),
    detail: detail.slice(0, 2000),
    status: requireStatus(status),
    priority,
  };
}

function constituencyRow(cells: string[]): UploadRow {
  const [name, place, designation, detail, phone] = cells;
  if (!name) throw new BadRequestException('Name is required.');
  const number = phone ? normalizeContactPhone(phone) : '';
  const parts = [place, designation, number, detail]
    .map((part) => part.trim())
    .filter(Boolean);
  return {
    kind: 'record',
    section: 'people',
    title: name.slice(0, 200),
    detail: parts.join(' · ').slice(0, 2000),
    status: 'Open',
  };
}

function contactRow(
  role: 'user' | 'person',
  cells: string[],
  withBirthday: boolean,
): UploadRow {
  const [name, phone, birthday, place, designation, notes, language] =
    withBirthday
      ? cells
      : [cells[0], cells[1], '', cells[2], cells[3], cells[4], 'en'];
  if (!name) throw new BadRequestException('Name is required.');
  if (!phone) throw new BadRequestException('Phone is required.');
  const parsed = birthday
    ? parseBirthday(birthday)
    : { birthday: '', birthYear: null };
  const lang = (language || 'en').toLowerCase();
  if (lang !== 'en' && lang !== 'te')
    throw new BadRequestException('Language must be en or te.');
  return {
    kind: 'contact',
    role,
    name: name.slice(0, 80),
    phone: normalizeContactPhone(phone),
    birthday: parsed.birthday,
    birthYear: parsed.birthYear,
    place: place.slice(0, 120),
    designation: designation.slice(0, 120),
    notes: notes.slice(0, 500),
    language: lang,
  };
}

function requireStatus(status: string): string {
  if (!STATUSES.has(status))
    throw new BadRequestException(
      'Status must be Open, In progress, or Closed.',
    );
  return status;
}

function requireDay(value: string): string {
  const day = calendarDay(value);
  if (!day) throw new BadRequestException('Date must be DD-MM-YYYY.');
  return day;
}

function calendarDay(value: string): string | null {
  const text = value.trim();
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const dmy = text.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  const year = iso ? Number(iso[1]) : dmy ? Number(dmy[3]) : 0;
  const month = iso ? Number(iso[2]) : dmy ? Number(dmy[2]) : 0;
  const day = iso ? Number(iso[3]) : dmy ? Number(dmy[1]) : 0;
  if (!year) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day)
    return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function visitClock(value: string): string {
  if (!value || value.toLowerCase() === 'anytime') return '';
  const time = parseVisitTime(value);
  if (time === null)
    throw new BadRequestException(
      'Time must be like 10:30 AM, 14:30, or Anytime.',
    );
  return time;
}

function blankRow(kind: UploadKind): UploadRow {
  if (kind === 'visits' || kind === 'schedule') {
    return {
      kind: 'visit',
      title: '',
      place: '',
      visitDate: '',
      visitTime: '',
      detail: '',
      leadPhone: '',
    };
  }
  if (kind === 'leaders' || kind === 'birthdays') {
    return {
      kind: 'contact',
      role: kind === 'leaders' ? 'person' : 'user',
      name: '',
      phone: '',
      birthday: '',
      birthYear: null,
      place: '',
      designation: '',
      notes: '',
      language: 'en',
    };
  }
  const section =
    kind === 'constituency'
      ? 'people'
      : kind === 'grievances'
        ? 'grievances'
        : kind === 'projects'
          ? 'projects'
          : 'campaigns';
  return { kind: 'record', section, title: '', detail: '', status: 'Open' };
}

function messageOf(err: BadRequestException): string {
  const response = err.getResponse();
  if (typeof response === 'string') return response;
  if (response && typeof response === 'object' && 'message' in response) {
    const message = response.message;
    return Array.isArray(message) ? String(message[0]) : String(message);
  }
  return err.message;
}

function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}
