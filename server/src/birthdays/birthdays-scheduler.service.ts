import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import {
  BIRTHDAY_TIMEZONE,
  birthdayWishesEnabled,
  hourInIndia,
  wishHour,
} from './birthdays';
import { BirthdaysService } from './birthdays.service';

/** Last hour (India time) at which a missed or retried wish may still go out. */
const LAST_HOUR = 21;

/**
 * Checks every 15 minutes from BIRTHDAY_HOUR to 21:00 India time. Each contact is wished once a day,
 * so a restart or redeploy during the day sends only what is still pending.
 */
@Injectable()
export class BirthdaysSchedulerService implements OnModuleInit {
  private readonly logger = new Logger(BirthdaysSchedulerService.name);

  constructor(
    private readonly registry: SchedulerRegistry,
    private readonly birthdays: BirthdaysService,
  ) {}

  onModuleInit(): void {
    if (!birthdayWishesEnabled()) {
      this.logger.log(
        'Birthday wishes are off (BIRTHDAY_WISHES_ENABLED=false or WhatsApp is not configured).',
      );
      return;
    }
    const job = new CronJob(
      '*/15 * * * *',
      () => void this.tick(),
      null,
      false,
      BIRTHDAY_TIMEZONE,
    );
    this.registry.addCronJob('birthday_wishes', job);
    job.start();
    this.logger.warn(
      `Birthday wishes armed: every 15 minutes from ${wishHour()}:00 to ${LAST_HOUR}:00 ${BIRTHDAY_TIMEZONE}.`,
    );
  }

  async tick(now = new Date()): Promise<void> {
    const hour = hourInIndia(now);
    if (hour < wishHour() || hour >= LAST_HOUR) return;
    try {
      const result = await this.birthdays.sendDue(fetch, now);
      if (result.due)
        this.logger.log(
          `[BIRTHDAY] ${result.day}: due=${result.due} sent=${result.sent} failed=${result.failed}`,
        );
    } catch (err) {
      this.logger.error(
        `[BIRTHDAY] check failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
