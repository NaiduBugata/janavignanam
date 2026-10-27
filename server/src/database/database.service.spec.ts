import {
  DatabaseService,
  describeDbError,
  isNeonReachabilityError,
  neonConnectOptions,
} from './database.service';
import { ConfigService } from '@nestjs/config';

describe('DatabaseService health probe contract helpers', () => {
  it('reports disconnected when MONGODB_URI missing', async () => {
    const config = {
      get: (key: string) => {
        if (key === 'database.uri') return '';
        if (key === 'database.name') return 'MediaSphere';
        if (key === 'database.articlesCollection') return 'articles';
        return undefined;
      },
    } as ConfigService;

    const db = new DatabaseService(config);
    await db.onModuleInit();
    expect(db.isConnected).toBe(false);
    const ok = await db.ensureConnected();
    expect(ok).toBe(false);
  });

  it('reports a nested connection code without the database URL or address', () => {
    const inner = Object.assign(new Error('connect ENETUNREACH 2001:db8::1'), {
      code: 'ENETUNREACH',
      syscall: 'connect',
    });
    const wrapped = new AggregateError([inner], '');
    const text = describeDbError(wrapped);
    expect(text).toContain('ENETUNREACH connect');
    expect(text).not.toContain('2001:db8');
    expect(
      describeDbError(
        new Error('failed postgresql://user:secret@db.example/neondb'),
      ),
    ).toBe('failed postgresql://***');
    expect(describeDbError(new Error(''))).toBe('unknown database error');
  });

  it('opens the database socket on IPv4 without Happy Eyeballs', () => {
    expect(neonConnectOptions(5432, 'db.example')).toEqual({
      port: 5432,
      host: 'db.example',
      family: 4,
      autoSelectFamily: false,
    });
  });

  it('treats TCP timeouts as unreachable and leaves authentication errors alone', () => {
    const timeout = Object.assign(new Error('connect ETIMEDOUT ipv4:5432'), {
      code: 'ETIMEDOUT',
    });
    expect(isNeonReachabilityError(new AggregateError([timeout], ''))).toBe(
      true,
    );
    expect(
      isNeonReachabilityError(
        Object.assign(new Error('password authentication failed'), {
          code: '28P01',
        }),
      ),
    ).toBe(false);
  });
});
