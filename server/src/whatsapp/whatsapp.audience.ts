/** Who may be answered, and who receives pipeline success and failure. Empty until contacts load. */

export type StaffRole = 'superadmin' | 'admin' | 'user';
export type ContactRole = StaffRole | 'person' | 'mp';

const rank: Record<StaffRole, number> = { user: 0, admin: 1, superadmin: 2 };

let loaded = false;
let superAdmins = new Set<string>();
let staff = new Set<string>();
let mps = new Set<string>();
let persons = new Map<string, string>();
let staffNames = new Map<string, string>();

function digits(value: string): string {
  return String(value || '').replace(/\D/g, '');
}

export function contactRole(value: unknown): ContactRole {
  return value === 'superadmin' ||
    value === 'admin' ||
    value === 'person' ||
    value === 'mp'
    ? value
    : 'user';
}

/** Admins stay admins. A person or the MP is not given a staff rank here. */
export function staffRole(value: unknown): StaffRole {
  const role = contactRole(value);
  if (role === 'person' || role === 'mp') return 'user';
  return role;
}

/** The highest staff role wins when the same number is stored more than once. */
export function setStaffDirectory(
  entries: Array<{ phone: string; role: ContactRole; name?: string }>,
): void {
  const best = new Map<string, StaffRole>();
  const people = new Map<string, string>();
  const names = new Map<string, string>();
  mps = new Set();
  for (const entry of entries) {
    const phone = digits(entry.phone);
    if (!phone) continue;
    const role = contactRole(entry.role);
    const name = (entry.name || '').trim();
    if (name) names.set(phone, name);
    if (role === 'person') {
      if (!people.has(phone)) people.set(phone, name || 'Person');
      continue;
    }
    if (role === 'mp') {
      mps.add(phone);
      continue;
    }
    const current = best.get(phone);
    if (!current || rank[role] > rank[current]) best.set(phone, role);
  }
  superAdmins = new Set(
    [...best]
      .filter(([, role]) => role === 'superadmin')
      .map(([phone]) => phone),
  );
  staff = new Set(
    [...best].filter(([, role]) => role !== 'user').map(([phone]) => phone),
  );
  persons = people;
  staffNames = names;
  loaded = true;
}

export function clearStaffDirectory(): void {
  loaded = false;
  superAdmins = new Set();
  staff = new Set();
  mps = new Set();
  persons = new Map();
  staffNames = new Map();
}

/** Phone of a saved contact whose name contains this word, such as Akshay. */
export function phoneForName(part: string): string | null {
  const needle = part.trim().toLowerCase();
  if (!needle) return null;
  for (const [phone, name] of staffNames) {
    if (name.toLowerCase().includes(needle)) return phone;
  }
  return null;
}

/** Name of a person who can file a grievance, when the directory is loaded. */
export function personName(phone: string): string | null {
  if (!loaded) return null;
  return persons.get(digits(phone)) ?? null;
}

export function isPersonPhone(phone: string): boolean {
  return personName(phone) !== null;
}

/** The MP's numbers. They ask for data from the menu and do not get automatic alerts. */
export function isMpPhone(phone: string): boolean {
  return loaded && mps.has(digits(phone));
}

export function isSuperAdminPhone(phone: string): boolean {
  return loaded && superAdmins.has(digits(phone));
}

export function staffDirectoryLoaded(): boolean {
  return loaded;
}

/** Sarojininaidu: pipeline success and failure, news fetched, grievance notices, and delivery failures. */
export function pipelineRecipients(): string[] {
  return [...superAdmins];
}

/** Super admin and admins. Automatic alerts other than the pipeline use this list. */
export function alertRecipients(): string[] {
  return [...staff];
}

/** Super admin, admins, and the MP. The bot answers these numbers. */
export function replyRecipients(): string[] {
  return [...new Set([...staff, ...mps])];
}
