import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import configuration from './config/configuration';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { NewsModule } from './news/news.module';
import { NotificationsModule } from './notifications/notifications.module';
import { AdminModule } from './admin/admin.module';
import { PipelineModule } from './pipeline/pipeline.module';
import { ReportsModule } from './reports/reports.module';
import { WhatsAppModule } from './whatsapp/whatsapp.module';
import { WorkspaceModule } from './workspace/workspace.module';
import { VisitsModule } from './visits/visits.module';
import { BirthdaysModule } from './birthdays/birthdays.module';
import { RagModule } from './rag/rag.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      envFilePath: ['.env', 'server/.env', '../server/.env'],
    }),
    // Phase 3: interval registry for the pipeline scheduler. The scheduler only
    // arms itself when PIPELINE_ON_API=true (single-writer rule).
    ScheduleModule.forRoot(),
    DatabaseModule,
    HealthModule,
    NewsModule,
    NotificationsModule,
    PipelineModule,
    ReportsModule,
    WhatsAppModule,
    WorkspaceModule,
    AdminModule,
    VisitsModule,
    BirthdaysModule,
    RagModule,
  ],
})
export class AppModule {}
