import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Socket, type SocketConnectOpts } from 'node:net';
import { Pool } from 'pg';
import { PgDocumentCollection } from './pg-collection';

/** One IPv4 address. Node's default Happy Eyeballs race also tries IPv6. */
export function neonConnectOptions(
  port: number,
  host?: string,
): SocketConnectOpts {
  return {
    port,
    host,
    family: 4,
    autoSelectFamily: false,
  };
}

export function createNeonSocket(): Socket {
  const socket = new Socket();
  const connect = socket.connect.bind(socket) as (
    options: SocketConnectOpts,
  ) => Socket;
  socket.connect = (first: unknown, second?: unknown) => {
    if (typeof first === 'number') {
      return connect(
        neonConnectOptions(
          first,
          typeof second === 'string' ? second : undefined,
        ),
      );
    }
    if (typeof first === 'object' && first) {
      return connect({
        ...(first as SocketConnectOpts),
        family: 4,
        autoSelectFamily: false,
      });
    }
    return connect(first as SocketConnectOpts);
  };
  return socket;
}

function safeError(err: unknown): string {
  return String(err instanceof Error ? err.message : err)
    .replace(/postgres(?:ql)?:\/\/\S+/gi, 'postgresql://***')
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, 'ipv4')
    .replace(/\b[0-9a-f:]{8,}\b/gi, 'ipv6');
}

/** Sanitized cause chain. pg can reject with an empty message while the code sits on a nested error. */
export function describeDbError(err: unknown): string {
  const parts: string[] = [];
  const visit = (value: unknown) => {
    if (parts.length > 4 || value == null) return;
    if (value instanceof AggregateError) {
      for (const item of value.errors) visit(item);
      return;
    }
    if (value instanceof Error) {
      const rawCode = 'code' in value ? value.code : undefined;
      const code =
        typeof rawCode === 'string' || typeof rawCode === 'number'
          ? String(rawCode)
          : '';
      const rawSyscall = 'syscall' in value ? value.syscall : undefined;
      const syscall =
        typeof rawSyscall === 'string' || typeof rawSyscall === 'number'
          ? String(rawSyscall)
          : '';
      const message = safeError(value);
      if (code || syscall || message)
        parts.push([code, syscall, message].filter(Boolean).join(' '));
      const nested = 'cause' in value ? value.cause : undefined;
      if (nested && nested !== value) visit(nested);
      return;
    }
    const message = safeError(value);
    if (message && message !== 'undefined') parts.push(message);
  };
  visit(err);
  return parts.join('; ') || 'unknown database error';
}

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name);
  private pool: Pool | null = null;
  private connected = false;
  private connectPromise: Promise<void> | null = null;
  private readonly gates = new Map<string, Promise<unknown>>();

  constructor(private readonly config: ConfigService) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.connect();
    } catch (err) {
      this.logger.warn(
        `Neon initial connect failed; will retry on health/data access: ${describeDbError(err)}`,
      );
      this.connected = false;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.close();
  }

  get isConnected(): boolean {
    return this.connected;
  }

  get dbName(): string {
    return this.config.get<string>('database.name') || 'neondb';
  }

  get articlesCollectionName(): string {
    return this.config.get<string>('database.articlesCollection') || 'articles';
  }

  async connect(): Promise<void> {
    const uri = this.config.get<string>('database.uri') || '';
    if (!uri) {
      this.logger.warn('NEON_DATABASE_URL missing — skipping database connect');
      this.connected = false;
      return;
    }

    if (this.connectPromise) {
      await this.connectPromise;
      return;
    }

    this.connectPromise = (async () => {
      if (!this.pool) {
        this.pool = new Pool({
          connectionString: uri.trim(),
          ssl: { rejectUnauthorized: true },
          max: 5,
          connectionTimeoutMillis: 10000,
          // pg connects by hostname, and Node 24 races AAAA records. Railway has
          // no IPv6 route, so that race reports ENETUNREACH plus IPv4 timeouts.
          stream: () => createNeonSocket(),
        });
      }
      await this.pool.query('SELECT 1');
      await this.pool.query('CREATE SCHEMA IF NOT EXISTS mediasphere');
      await this.pool.query(`
        CREATE TABLE IF NOT EXISTS mediasphere.documents (
          collection text NOT NULL,
          doc_id text NOT NULL,
          doc jsonb NOT NULL,
          exported_at timestamptz NOT NULL DEFAULT now(),
          PRIMARY KEY (collection, doc_id)
        )
      `);
      this.connected = true;
      this.logger.log('Neon connected (schema=mediasphere)');
    })();

    try {
      await this.connectPromise;
    } catch (err) {
      this.connected = false;
      throw new Error(describeDbError(err));
    } finally {
      this.connectPromise = null;
    }
  }

  async close(): Promise<void> {
    if (!this.pool) return;
    try {
      await this.pool.end();
    } catch (err) {
      this.logger.warn('Neon close error: ' + safeError(err));
    }
    this.pool = null;
    this.connected = false;
  }

  async ensureConnected(): Promise<boolean> {
    try {
      if (!this.pool) await this.connect();
      else await this.pool.query('SELECT 1');
      this.connected = Boolean(this.pool);
      return this.connected;
    } catch {
      this.connected = false;
      try {
        await this.close();
        await this.connect();
        return this.connected;
      } catch {
        this.connected = false;
        return false;
      }
    }
  }

  collection(name: string): PgDocumentCollection {
    if (!this.pool) throw new Error('Neon database is not initialized');
    return new PgDocumentCollection(this.pool, name, (fn) =>
      this.exclusive(name, fn),
    );
  }

  /** Plain SQL for tables outside the document store (for example uploaded file bytes). */
  async query<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params: unknown[] = [],
  ): Promise<T[]> {
    if (!this.pool) throw new Error('Neon database is not initialized');
    const result = await this.pool.query(sql, params);
    return result.rows as T[];
  }

  articles(): PgDocumentCollection {
    return this.collection(this.articlesCollectionName);
  }

  async ping(): Promise<{ ok: boolean; latencyMs: number }> {
    const ok = await this.ensureConnected();
    if (!ok || !this.pool) throw new Error('Neon database unavailable');
    const started = Date.now();
    await this.pool.query('SELECT 1');
    return {
      ok: true,
      latencyMs: Math.round((Date.now() - started) * 100) / 100,
    };
  }

  private exclusive<T>(name: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.gates.get(name) ?? Promise.resolve();
    const run = previous.then(fn, fn);
    this.gates.set(
      name,
      run.then(
        () => undefined,
        () => undefined,
      ),
    );
    return run;
  }
}
