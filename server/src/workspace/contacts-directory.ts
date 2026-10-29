import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

type RawContact = [
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
];

export type DirectoryContact = {
  name: string;
  phone: string;
  designation: string;
  party: string;
  important: string;
  assembly: string;
  mandal: string;
  village: string;
  division: string;
  membershipId: string;
  sources: string;
  variants: string;
  notes: string;
};

export type ContactFacet = { name: string; count: number };

type Loaded = {
  rows: DirectoryContact[];
  search: string[];
};

let loaded: Loaded | null = null;

const ASSEMBLY_ORDER = [
  'Pedakurapadu',
  'Chilakaluripet',
  'Narasaraopet',
  'Sattenapalli',
  'Vinukonda',
  'Gurazala',
  'Macherla',
  'Unassigned',
];
const DIVISION_ORDER = [
  'Narasaraopet',
  'Sattenapalli',
  'Gurazala',
  'No division',
];

function load(): Loaded {
  if (loaded) return loaded;
  const file = [
    join(__dirname, 'data', 'palnadu-contacts.json'),
    join(process.cwd(), 'src', 'workspace', 'data', 'palnadu-contacts.json'),
    join(process.cwd(), 'dist', 'workspace', 'data', 'palnadu-contacts.json'),
  ].find((candidate) => existsSync(candidate));
  if (!file) throw new Error('Palnadu contact list is missing');
  const raw = JSON.parse(readFileSync(file, 'utf8')) as RawContact[];
  const rows = raw.map((item) => ({
    name: item[0] || '',
    phone: item[1] || '',
    designation: item[2] || '',
    party: item[3] || '',
    important: item[4] || '',
    assembly: item[5] || 'Unassigned',
    mandal: item[6] || '',
    village: item[7] || '',
    division: item[8] || 'No division',
    membershipId: item[9] || '',
    sources: item[10] || '',
    variants: item[11] || '',
    notes: item[12] || '',
  }));
  loaded = {
    rows,
    search: rows.map((row) =>
      [
        row.name,
        row.phone,
        row.designation,
        row.party,
        row.important,
        row.assembly,
        row.mandal,
        row.village,
        row.division,
        row.membershipId,
        row.sources,
        row.variants,
        row.notes,
      ]
        .join(' ')
        .toLowerCase(),
    ),
  };
  return loaded;
}

function counts(
  rows: DirectoryContact[],
  pick: (row: DirectoryContact) => string,
  order: string[],
): ContactFacet[] {
  const map = new Map<string, number>();
  for (const row of rows) {
    const name = pick(row) || '';
    if (!name) continue;
    map.set(name, (map.get(name) || 0) + 1);
  }
  return [...map.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => {
      const ai = order.indexOf(a.name);
      const bi = order.indexOf(b.name);
      if (ai !== -1 || bi !== -1)
        return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
      return b.count - a.count || a.name.localeCompare(b.name);
    });
}

export function queryContacts(input: {
  q?: string;
  division?: string;
  assembly?: string;
  role?: string;
  page?: number;
}): {
  total: number;
  page: number;
  pageSize: number;
  divisions: ContactFacet[];
  assemblies: ContactFacet[];
  roles: ContactFacet[];
  rows: DirectoryContact[];
} {
  const { rows, search } = load();
  const pageSize = 40;
  const q = (input.q || '').trim().toLowerCase();
  const digits = q.replace(/\D/g, '');
  const division = (input.division || '').trim();
  const assembly = (input.assembly || '').trim();
  const role = (input.role || '').trim().toLowerCase();
  const matchesQuery = (index: number, row: DirectoryContact) => {
    if (!q) return true;
    if (digits.length >= 3 && row.phone.replace(/\D/g, '').includes(digits))
      return true;
    return search[index].includes(q);
  };
  const matchesRole = (row: DirectoryContact) => {
    if (!role) return true;
    if (role === '__none__') return !row.designation;
    return row.designation.toLowerCase().includes(role);
  };
  const searched = rows.filter((row, index) => matchesQuery(index, row));
  const inDivision = division
    ? searched.filter((row) => row.division === division)
    : searched;
  const inAssembly = assembly
    ? inDivision.filter((row) => row.assembly === assembly)
    : inDivision;
  const matched = inAssembly.filter(matchesRole);
  const page = Math.min(
    Math.max(1, Number(input.page) || 1),
    Math.max(1, Math.ceil(matched.length / pageSize)),
  );
  const start = (page - 1) * pageSize;
  return {
    total: matched.length,
    page,
    pageSize,
    divisions: counts(
      searched.filter(
        (row) => (!assembly || row.assembly === assembly) && matchesRole(row),
      ),
      (row) => row.division,
      DIVISION_ORDER,
    ),
    assemblies: counts(
      searched.filter(
        (row) => (!division || row.division === division) && matchesRole(row),
      ),
      (row) => row.assembly,
      ASSEMBLY_ORDER,
    ),
    roles: counts(
      inAssembly,
      (row) => row.designation || 'No designation',
      [],
    ).slice(0, 400),
    rows: matched.slice(start, start + pageSize),
  };
}
