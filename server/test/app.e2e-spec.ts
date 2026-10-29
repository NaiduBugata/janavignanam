import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';

describe('Read-path (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.enableShutdownHooks();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/health returns status ok and mongo boolean', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/health')
      .expect(200);
    expect(res.body.status).toBe('ok');
    expect(typeof res.body.mongo).toBe('boolean');
  });

  it('GET /api/news returns articles contract', async () => {
    const res = await request(app.getHttpServer()).get('/api/news').expect(200);
    expect(Array.isArray(res.body.articles)).toBe(true);
    expect(typeof res.body.count).toBe('number');
    expect(res.headers['cache-control']).toMatch(/no-store/i);
  });

  it('GET /api/news/stats returns aggregates', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/news/stats')
      .expect(200);
    expect(typeof res.body.total).toBe('number');
    expect(Array.isArray(res.body.daily_trend)).toBe(true);
    expect(res.body.daily_trend).toHaveLength(7);
  });

  it('GET /api/notifications/status returns email/whatsapp', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/notifications/status')
      .expect(200);
    expect(res.body.email).toBeDefined();
    expect(res.body.whatsapp).toBeDefined();
  });
});
