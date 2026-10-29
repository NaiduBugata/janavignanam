/** Mock follow-up directory. Every contact uses this number. */
export const FOLLOWUP_PHONE = '918919537879';
export const FOLLOWUP_PHONE_LABEL = '891 953 7879';
export const FOLLOWUP_FREQUENT_AFTER = 2;

export type FollowupBucket = 'recent' | 'frequent' | 'pending';

export interface FollowupContact {
  id: string;
  name: string;
  phone: string;
  count: number;
  lastFollowedAt: string | null;
}

const RECENT_NAMES = [
  'Ravi Teja',
  'Ananya Reddy',
  'Suresh Babu',
  'Lakshmi Devi',
  'Praveen Kumar',
  'Sravani Rao',
  'Venkat Reddy',
  'Meena Kumari',
  'Harish Naidu',
  'Divya Sri',
  'Naveen Chandra',
  'Pooja Sharma',
  'Kiran Kumar',
  'Swathi Reddy',
  'Ajay Krishna',
  'Bhavani Rao',
  'Manoj Varma',
  'Keerthi Nair',
  'Sandeep Yadav',
  'Ramya Krishna',
  'Gopal Rao',
  'Sindhu Priya',
  'Chaitanya Rao',
  'Nandini Iyer',
  'Vikram Singh',
];

const FREQUENT_NAMES = [
  'Arjun Reddy',
  'Kavya Nair',
  'Ramesh Goud',
  'Pallavi Sharma',
  'Srinivas Rao',
  'Deepika Reddy',
  'Mahesh Babu',
  'Shreya Patel',
  'Anil Kumar',
  'Harika Devi',
  'Rajesh Naidu',
  'Sneha Iyer',
  'Prasad Varma',
  'Lavanya Sri',
  'Vamsi Krishna',
  'Jyothi Rao',
  'Karthik Reddy',
  'Aishwarya Rao',
  'Sathish Kumar',
  'Madhavi Devi',
  'Nitin Sharma',
  'Priyanka Reddy',
  'Raghu Ram',
  'Tejaswini Rao',
  'Yashwanth Goud',
];

const PENDING_NAMES = [
  'Balaji Rao',
  'Ishwarya Devi',
  'Murali Krishna',
  'Tanvi Reddy',
  'Sai Kiran',
  'Anusha Rao',
  'Dinesh Goud',
  'Padma Lakshmi',
];

let contacts: FollowupContact[] | null = null;

export function resetFollowupContacts(): void {
  contacts = seed();
}

export function allFollowupContacts(): FollowupContact[] {
  if (!contacts) contacts = seed();
  return contacts;
}

export function followupBucket(contact: FollowupContact): FollowupBucket {
  if (contact.count <= 0) return 'pending';
  if (contact.count >= FOLLOWUP_FREQUENT_AFTER) return 'frequent';
  return 'recent';
}

export function followupContactsIn(bucket: FollowupBucket): FollowupContact[] {
  const rows = allFollowupContacts().filter(
    (row) => followupBucket(row) === bucket,
  );
  if (bucket === 'pending')
    return [...rows].sort((left, right) => left.name.localeCompare(right.name));
  if (bucket === 'frequent')
    return [...rows].sort(
      (left, right) =>
        right.count - left.count || left.name.localeCompare(right.name),
    );
  return [...rows].sort(
    (left, right) =>
      String(right.lastFollowedAt || '').localeCompare(
        String(left.lastFollowedAt || ''),
      ) || left.name.localeCompare(right.name),
  );
}

export function findFollowupContact(id: string): FollowupContact | undefined {
  return allFollowupContacts().find((row) => row.id === id);
}

/** Marks a follow-up done. First send goes to Recent; later sends go to Frequently Followed Up. */
export function recordFollowup(
  id: string,
  at = new Date(),
): FollowupContact | undefined {
  const contact = findFollowupContact(id);
  if (!contact) return undefined;
  contact.count += 1;
  contact.lastFollowedAt = at.toISOString();
  return contact;
}

export function followupMessage(name: string): string {
  return `Hello ${name}, this is a follow-up from the MP office of Sri Lavu Sri Krishna Devarayulu. Please share if you still need any help. Thank you.`;
}

function seed(): FollowupContact[] {
  const recent = RECENT_NAMES.map((name, index) =>
    contact(
      `r${pad(index + 1)}`,
      name,
      1,
      `2026-10-13T0${Math.min(9, index)}:00:00.000Z`,
    ),
  );
  const frequent = FREQUENT_NAMES.map((name, index) =>
    contact(
      `f${pad(index + 1)}`,
      name,
      2 + (index % 3),
      `2026-10-12T0${Math.min(9, index)}:30:00.000Z`,
    ),
  );
  const pending = PENDING_NAMES.map((name, index) =>
    contact(`n${pad(index + 1)}`, name, 0, null),
  );
  return [...recent, ...frequent, ...pending];
}

function contact(
  id: string,
  name: string,
  count: number,
  lastFollowedAt: string | null,
): FollowupContact {
  return { id, name, phone: FOLLOWUP_PHONE, count, lastFollowedAt };
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}
