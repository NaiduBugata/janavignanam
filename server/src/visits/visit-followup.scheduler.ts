import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { whatsappSenderReady } from '../birthdays/birthdays';
import { VisitFollowupService } from './visit-followup.service';

/**
 * Checks every 15 minutes. A visit gets at most three reminders before it starts, and only to its own numbers.
 * Each reminder is marked after it is accepted, so a restart does not send that reminder again.
 */
@Injectable()
export class VisitFollowupScheduler implements OnModuleInit {
  private readonly logger = new Logger(VisitFollowupScheduler.name);

  constructor(
    private readonly registry: SchedulerRegistry,
    private readonly followUp: VisitFollowupService,
  ) {}

  onModuleInit(): void {
    if (!whatsappSenderReady()) {
      this.logger.log(
        'Visit follow-up is off because WhatsApp is not configured.',
      );
      return;
    }
    const job = new CronJob(
      '*/15 * * * *',
      () => void this.tick(),
      null,
      false,
      'Asia/Kolkata',
    );
    this.registry.addCronJob('visit_followup', job);
    job.start();
    this.logger.warn('Visit follow-up armed: every 15 minutes, Asia/Kolkata.');
  }

  async tick(now = new Date()): Promise<void> {
    try {
      const result = await this.followUp.sendDue(fetch, now);
      if (result.due) {
        this.logger.log(
          `[VISIT_FOLLOWUP] due=${result.due} sent=${result.sent} failed=${result.failed}`,
        );
      }
    } catch (err) {
      this.logger.error(
        `[VISIT_FOLLOWUP] check failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
