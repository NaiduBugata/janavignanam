import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { calendarDay, previousReportDay, zoneParts } from './report-stats';
import { ReportsService } from './reports.service';
import { notifyHealthWhatsApp } from '../whatsapp/whatsapp.notify';
import { truthy } from '../common/utils/truthy';

/**
 * Daily report cron. Stays off unless REPORT_SCHEDULER_ON_API=true, so Flask
 * remains the only process that emails the 07:00 report.
 */
@Injectable()
export class ReportsSchedulerService implements OnModuleInit {
  private readonly logger = new Logger(ReportsSchedulerService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly registry: SchedulerRegistry,
    private readonly reports: ReportsService,
  ) {}

  onModuleInit(): void {
    const enabled = this.config.get<boolean>('reports.enabled');
    const onApi = this.config.get<boolean>('reports.schedulerOnApi');
    if (!enabled || !onApi) {
      this.logger.log(
        'Daily report scheduler is off. Flask remains the report sender.',
      );
      return;
    }
    const hour = this.config.get<number>('reports.hour') ?? 7;
    const minute = this.config.get<number>('reports.minute') ?? 0;
    const timezone =
      this.config.get<string>('reports.timezone') || 'Asia/Kolkata';
    const job = new CronJob(
      `${minute} ${hour} * * *`,
      () => {
        void this.runScheduled();
      },
      null,
      false,
      timezone,
    );
    this.registry.addCronJob('daily_report', job);
    job.start();
    this.logger.warn(
      `Daily report scheduler armed for ${hour}:${String(minute).padStart(2, '0')} ${timezone}.`,
    );
    if (this.config.get<boolean>('reports.catchupOnStart')) void this.catchUp();
  }

  private async runScheduled(): Promise<void> {
    try {
      const result = await this.reports.generateAndSend(null);
      this.logger.log(`Scheduled report result: ${result.status}`);
      await notifyHealthWhatsApp({
        Database: 'ok',
        Collectors: 'ok',
        Email: truthy(process.env.EMAIL_ENABLED) ? 'ok' : 'disabled',
        WhatsApp: truthy(process.env.WHATSAPP_ENABLED) ? 'ok' : 'disabled',
        Scheduler: 'ok',
      });
    } catch (err) {
      this.logger.error(err instanceof Error ? err.message : String(err));
    }
  }

  private async catchUp(): Promise<void> {
    const target = expectedReportDate(new Date());
    const result = await this.reports.generateAndSend(target);
    this.logger.log(`Catch-up report result: ${result.status}`);
  }
}

export function expectedReportDate(now: Date): string {
  const timezone = process.env.REPORT_TIMEZONE || 'Asia/Kolkata';
  const hour = Number(process.env.REPORT_HOUR || '7');
  const minute = Number(process.env.REPORT_MINUTE || '0');
  const parts = zoneParts(now, timezone);
  const afterSlot =
    Number(parts.hour) > hour ||
    (Number(parts.hour) === hour && Number(parts.minute) >= minute);
  const today = calendarDay(now, timezone);
  const yesterday = previousReportDay(now, timezone);
  if (afterSlot) return yesterday;
  const [year, month, day] = today.split('-').map(Number);
  const utc = new Date(Date.UTC(year, month - 1, day));
  utc.setUTCDate(utc.getUTCDate() - 2);
  return utc.toISOString().slice(0, 10);
}
