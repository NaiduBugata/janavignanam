import 'reflect-metadata';
import { Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ScheduleModule } from '@nestjs/schedule';
import { ArticleRepository } from '../database/repositories/article.repository';
import { PipelineStateRepository } from '../database/repositories/pipeline-state.repository';
import { DatabaseService } from '../database/database.service';
import { ConfigService } from '@nestjs/config';
import { ChatbotModule } from './chatbot.module';
import { ChatbotService } from './chatbot.service';

const stored = [
  {
    title: 'Cordon search in Narasaraopet',
    summary: 'Police searched the Pedda Cheruvu area.',
    category: 'Crime',
    location: { town: 'Narasaraopet', district: 'Palnadu' },
    source: 'youtube',
    created_on: '2026-09-27T07:26:08Z',
    assembly_segment: 'Narasaraopet',
  },
  {
    title: 'Guntur city traffic jam',
    summary: 'Not part of the constituency dataset.',
    source: 'sakshi',
    created_on: '2026-09-27T08:00:00Z',
  },
];

@Global()
@Module({
  providers: [
    { provide: ArticleRepository, useValue: { findAll: async () => stored } },
    { provide: PipelineStateRepository, useValue: {} },
    { provide: ConfigService, useValue: { get: () => 'test' } },
    {
      provide: DatabaseService,
      useValue: {
        ensureConnected: async () => true,
        collection: () => ({
          find: () => ({
            sort: () => ({ limit: () => ({ toArray: async () => [] }) }),
            toArray: async () => [],
          }),
          findOne: async () => null,
          findOneAndUpdate: async () => null,
          insertOne: async () => ({ insertedId: '1' }),
        }),
      },
    },
  ],
  exports: [
    ArticleRepository,
    PipelineStateRepository,
    DatabaseService,
    ConfigService,
  ],
})
class FakeDatabaseModule {}

describe('ChatbotModule wiring', () => {
  it('injects the global article repository so replies can use stored news', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ScheduleModule.forRoot(), FakeDatabaseModule, ChatbotModule],
    }).compile();
    const bot = moduleRef.get(ChatbotService);
    const briefs = await bot['loadNews']();
    expect(briefs.map((brief) => brief.title)).toEqual([
      'Cordon search in Narasaraopet',
    ]);
    expect(briefs[0].place).toBe('Narasaraopet, Palnadu');
    await moduleRef.close();
  });
});
