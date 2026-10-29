import { ObjectId } from 'mongodb';

export interface SqlPool {
  query(
    sql: string,
    params?: unknown[],
  ): Promise<{
    rows: Array<Record<string, unknown>>;
    rowCount?: number | null;
  }>;
}

const DATE_FIELDS = new Set([
  'expires_at',
  'acquired_at',
  'updated_at',
  'released_at',
]);

export class DuplicateDocumentError extends Error {
  readonly code = 11000;

  constructor() {
    super('duplicate document');
  }
}

type Filter = Record<string, unknown>;
type Doc = Record<string, unknown>;

function isOperator(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  if (value instanceof Date || isObjectId(value)) return false;
  return Object.keys(value).some((key) => key.startsWith('$'));
}

function isObjectId(value: unknown): value is ObjectId {
  return Boolean(
    value &&
    typeof value === 'object' &&
    typeof (value as ObjectId).toHexString === 'function',
  );
}

function idKey(value: unknown): string | null {
  if (isObjectId(value)) return value.toHexString();
  if (typeof value === 'string' && /^[a-f0-9]{24}$/i.test(value))
    return value.toLowerCase();
  return null;
}

function same(actual: unknown, expected: unknown): boolean {
  if (actual === expected) return true;
  const left = idKey(actual);
  const right = idKey(expected);
  if (left && right) return left === right;
  const leftTime = timeOf(actual);
  const rightTime = timeOf(expected);
  if (leftTime != null && rightTime != null) return leftTime === rightTime;
  return false;
}

function timeOf(value: unknown): number | null {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

function compare(actual: unknown, expected: unknown): number {
  const leftTime = timeOf(actual);
  const rightTime = timeOf(expected);
  if (leftTime != null && rightTime != null) return leftTime - rightTime;
  const left = actual == null ? '' : String(actual);
  const right = expected == null ? '' : String(expected);
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function matchValue(actual: unknown, expected: unknown): boolean {
  if (isOperator(expected)) {
    if ('$in' in expected) {
      const list = expected.$in;
      return Array.isArray(list) && list.some((item) => same(actual, item));
    }
    if ('$lte' in expected) return compare(actual, expected.$lte) <= 0;
    if ('$exists' in expected) {
      const exists = actual !== undefined;
      return expected.$exists ? exists : !exists;
    }
    return false;
  }
  if (expected === null) return actual == null;
  return same(actual, expected);
}

export function matches(doc: Doc, filter: Filter | undefined): boolean {
  if (!filter) return true;
  const entries = Object.entries(filter);
  if (!entries.length) return true;
  for (const [key, expected] of entries) {
    if (key === '$or') {
      const clauses = Array.isArray(expected) ? expected : [];
      if (!clauses.some((clause) => matches(doc, clause as Filter)))
        return false;
      continue;
    }
    if (!matchValue(doc[key], expected)) return false;
  }
  return true;
}

function equalityFields(filter: Filter): Doc {
  const doc: Doc = {};
  for (const [key, value] of Object.entries(filter)) {
    if (key.startsWith('$') || isOperator(value)) continue;
    doc[key] = value;
  }
  return doc;
}

function hydrate(raw: unknown): Doc {
  const doc = revive(raw) as Doc;
  for (const key of DATE_FIELDS) {
    const value = doc[key];
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)) {
      const date = new Date(value);
      if (!Number.isNaN(date.getTime())) doc[key] = date;
    }
  }
  return doc;
}

function revive(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(revive);
  if (!value || typeof value !== 'object') return value;
  const record = value as Doc;
  if (typeof record.$oid === 'string' && Object.keys(record).length === 1) {
    return new ObjectId(record.$oid);
  }
  if (typeof record.$date === 'string' && Object.keys(record).length === 1) {
    return new Date(record.$date);
  }
  const next: Doc = {};
  for (const [key, item] of Object.entries(record)) next[key] = revive(item);
  return next;
}

function serialize(doc: Doc): string {
  return JSON.stringify(toJson(doc));
}

function toJson(value: unknown): unknown {
  if (value instanceof Date) return { $date: value.toISOString() };
  if (isObjectId(value)) return { $oid: value.toHexString() };
  if (Array.isArray(value)) return value.map(toJson);
  if (value && typeof value === 'object') {
    const next: Doc = {};
    for (const [key, item] of Object.entries(value as Doc))
      next[key] = toJson(item);
    return next;
  }
  return value;
}

function docId(doc: Doc): string {
  if (doc._id == null) doc._id = new ObjectId();
  if (isObjectId(doc._id)) return doc._id.toHexString();
  return String(doc._id);
}

function sqlLiteral(value: unknown): string | null {
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  )
    return String(value);
  return null;
}

/** Count query for an empty filter, field equality, or `$in`. Returns null when the filter needs a full read. */
function sqlCount(
  collection: string,
  filter: Filter,
): { text: string; params: unknown[] } | null {
  const params: unknown[] = [collection];
  const clauses = ['collection = $1'];
  for (const [key, expected] of Object.entries(filter)) {
    if (key.startsWith('$')) return null;
    if (expected === null) {
      params.push(key);
      clauses.push(`doc->>$${params.length} IS NULL`);
      continue;
    }
    const literal = sqlLiteral(expected);
    if (literal !== null) {
      params.push(key, literal);
      clauses.push(`doc->>$${params.length - 1} = $${params.length}`);
      continue;
    }
    if (isOperator(expected) && Array.isArray(expected.$in)) {
      const values = expected.$in.map(sqlLiteral);
      if (values.some((value) => value === null)) return null;
      params.push(key, values);
      clauses.push(
        `doc->>$${params.length - 1} = ANY($${params.length}::text[])`,
      );
      continue;
    }
    return null;
  }
  return {
    text: `SELECT count(*)::int AS n FROM mediasphere.documents WHERE ${clauses.join(' AND ')}`,
    params,
  };
}

function project(doc: Doc, projection?: Record<string, number>): Doc {
  if (!projection) return doc;
  const include = Object.entries(projection).filter(([, flag]) => flag);
  if (!include.length) return doc;
  const next: Doc = {};
  if (projection._id !== 0 && doc._id !== undefined) next._id = doc._id;
  for (const [key, flag] of include) {
    if (key === '_id' || !flag) continue;
    if (key in doc) next[key] = doc[key];
  }
  return next;
}

class QueryCursor {
  private sortSpec: Record<string, number> | null = null;
  private max: number | null = null;

  constructor(
    private readonly load: () => Promise<Doc[]>,
    private readonly filter: Filter,
  ) {}

  sort(spec: Record<string, number>): this {
    this.sortSpec = spec;
    return this;
  }

  limit(count: number): this {
    this.max = count;
    return this;
  }

  async toArray(): Promise<Doc[]> {
    let rows = (await this.load()).filter((doc) => matches(doc, this.filter));
    if (this.sortSpec) {
      const [field, direction] = Object.entries(this.sortSpec)[0] || [];
      if (field) {
        const sign = direction < 0 ? -1 : 1;
        rows.sort((a, b) => sign * compare(a[field], b[field]));
      }
    }
    if (this.max != null) rows = rows.slice(0, this.max);
    return rows;
  }
}

/** Document collection stored as JSON rows in Neon (`mediasphere.documents`). */
export class PgDocumentCollection {
  constructor(
    private readonly pool: SqlPool,
    private readonly name: string,
    private readonly exclusive: <T>(fn: () => Promise<T>) => Promise<T>,
  ) {}

  private async load(): Promise<Doc[]> {
    const result = await this.pool.query(
      'SELECT doc_id, doc FROM mediasphere.documents WHERE collection = $1',
      [this.name],
    );
    return result.rows.map((row: { doc_id?: string; doc: unknown }) => {
      const doc = hydrate(row.doc);
      if (doc._id == null && row.doc_id) doc._id = row.doc_id;
      return doc;
    });
  }

  find(filter: Filter = {}): QueryCursor {
    return new QueryCursor(() => this.load(), filter);
  }

  async findOne(
    filter: Filter = {},
    options?: {
      sort?: Record<string, number>;
      projection?: Record<string, number>;
    },
  ): Promise<Doc | null> {
    const fast = await this.tryFastFindOne(filter, options);
    if (fast !== undefined) return fast;
    const rows = (await this.load()).filter((doc) => matches(doc, filter));
    if (options?.sort) {
      const [field, direction] = Object.entries(options.sort)[0] || [];
      if (field) {
        const sign = direction < 0 ? -1 : 1;
        rows.sort((a, b) => sign * compare(a[field], b[field]));
      }
    }
    const doc = rows[0];
    return doc ? project(doc, options?.projection) : null;
  }

  async countDocuments(filter: Filter = {}): Promise<number> {
    const counted = sqlCount(this.name, filter);
    if (counted) {
      const result = await this.pool.query(counted.text, counted.params);
      return Number(result.rows[0]?.n || 0);
    }
    return (await this.load()).filter((doc) => matches(doc, filter)).length;
  }

  async insertOne(doc: Doc): Promise<{ insertedId: unknown }> {
    return this.exclusive(async () => {
      const stored = { ...doc };
      const id = docId(stored);
      const existing = await this.pool.query(
        'SELECT 1 FROM mediasphere.documents WHERE collection = $1 AND doc_id = $2',
        [this.name, id],
      );
      if (existing.rowCount) throw new DuplicateDocumentError();
      await this.pool.query(
        `INSERT INTO mediasphere.documents (collection, doc_id, doc)
         VALUES ($1, $2, $3::jsonb)`,
        [this.name, id, serialize(stored)],
      );
      return { insertedId: stored._id };
    });
  }

  /** New documents only: every `_id` is freshly generated, so there is no duplicate check. */
  async insertMany(docs: Doc[]): Promise<{ insertedIds: unknown[] }> {
    if (!docs.length) return { insertedIds: [] };
    return this.exclusive(async () => {
      const stored = docs.map((doc) => {
        const copy = { ...doc };
        delete copy._id;
        return copy;
      });
      const ids = stored.map((doc) => docId(doc));
      await this.pool.query(
        `INSERT INTO mediasphere.documents (collection, doc_id, doc)
         SELECT $1, t.id, t.doc::jsonb FROM unnest($2::text[], $3::text[]) AS t(id, doc)`,
        [this.name, ids, stored.map(serialize)],
      );
      return { insertedIds: stored.map((doc) => doc._id) };
    });
  }

  async updateOne(
    filter: Filter,
    update: { $set?: Doc; $setOnInsert?: Doc },
    options?: { upsert?: boolean },
  ): Promise<{
    matchedCount: number;
    modifiedCount: number;
    upsertedCount: number;
    upsertedId: unknown;
  }> {
    return this.exclusive(async () => {
      const rows = await this.load();
      const hit = rows.find((doc) => matches(doc, filter));
      if (hit) {
        Object.assign(hit, update.$set || {});
        await this.write(hit);
        return {
          matchedCount: 1,
          modifiedCount: 1,
          upsertedCount: 0,
          upsertedId: null,
        };
      }
      if (!options?.upsert) {
        return {
          matchedCount: 0,
          modifiedCount: 0,
          upsertedCount: 0,
          upsertedId: null,
        };
      }
      const created: Doc = {
        ...equalityFields(filter),
        ...(update.$setOnInsert || {}),
        ...(update.$set || {}),
      };
      docId(created);
      await this.write(created);
      return {
        matchedCount: 0,
        modifiedCount: 0,
        upsertedCount: 1,
        upsertedId: created._id,
      };
    });
  }

  async findOneAndUpdate(
    filter: Filter,
    update: { $set?: Doc; $push?: Record<string, unknown> },
    _options?: { returnDocument?: string },
  ): Promise<Doc | null> {
    return this.exclusive(async () => {
      const hit = (await this.load()).find((doc) => matches(doc, filter));
      if (!hit) return null;
      if (update.$set) Object.assign(hit, update.$set);
      if (update.$push) {
        for (const [key, value] of Object.entries(update.$push)) {
          if (!Array.isArray(hit[key])) hit[key] = [];
          (hit[key] as unknown[]).push(value);
        }
      }
      await this.write(hit);
      return hit;
    });
  }

  async deleteOne(filter: Filter): Promise<{ deletedCount: number }> {
    return this.exclusive(async () => {
      const hit = (await this.load()).find((doc) => matches(doc, filter));
      if (!hit) return { deletedCount: 0 };
      const result = await this.pool.query(
        'DELETE FROM mediasphere.documents WHERE collection = $1 AND doc_id = $2',
        [this.name, docId(hit)],
      );
      return { deletedCount: result.rowCount || 0 };
    });
  }

  async createIndex(_keys: Record<string, number>): Promise<string> {
    return 'ok';
  }

  /** Equality and `$in` filters can be counted in SQL. Anything else returns null. */
  private async tryFastFindOne(
    filter: Filter,
    options?: {
      sort?: Record<string, number>;
      projection?: Record<string, number>;
    },
  ): Promise<Doc | null | undefined> {
    const counted = sqlCount(this.name, filter);
    if (!counted) return undefined;
    const sort = Object.entries(options?.sort || {});
    if (sort.length > 1) return undefined;
    const params = [...counted.params];
    let text = counted.text.replace(
      /^SELECT count\(\*\)::int AS n/,
      'SELECT doc',
    );
    if (sort.length === 1) {
      const [field, direction] = sort[0];
      params.push(field);
      text += ` ORDER BY doc->>$${params.length} ${direction < 0 ? 'DESC' : 'ASC'} NULLS LAST`;
    }
    text += ' LIMIT 1';
    const result = await this.pool.query(text, params);
    const row = result.rows[0] as { doc?: unknown } | undefined;
    if (!row) return null;
    return project(hydrate(row.doc), options?.projection);
  }

  private async write(doc: Doc): Promise<void> {
    const id = docId(doc);
    await this.pool.query(
      `INSERT INTO mediasphere.documents (collection, doc_id, doc)
       VALUES ($1, $2, $3::jsonb)
       ON CONFLICT (collection, doc_id) DO UPDATE
       SET doc = EXCLUDED.doc, exported_at = now()`,
      [this.name, id, serialize(doc)],
    );
  }
}
