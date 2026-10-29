import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ArticleRepository } from '../database/repositories/article.repository';
import { NotificationStatusRepository } from '../database/repositories/notification-status.repository';
import { DailyReportRepository } from '../database/repositories/daily-report.repository';
import { truthy } from '../common/utils/truthy';
import { whatsappAlertsEnabled } from '../whatsapp/whatsapp.send';

@Injectable()
export class NotificationsService {
  constructor(
    private readonly config: ConfigService,
    private readonly articles: ArticleRepository,
    private readonly statusStore: NotificationStatusRepository,
    private readonly dailyReports: DailyReportRepository,
  ) {}

  private emailConfigured(): { enabled: boolean; configured: boolean } {
    const enabled = truthy(this.config.get('email.enabled'));
    const recipients = String(this.config.get('email.recipients') || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const provider = String(
      this.config.get('email.provider') || 'auto',
    ).toLowerCase();
    const hasResend = Boolean(this.config.get('email.resendApiKey'));
    const hasSmtp = Boolean(
      this.config.get('email.smtpUsername') &&
      this.config.get('email.smtpPassword'),
    );
    let configured = recipients.length > 0 && (hasResend || hasSmtp);
    if (provider === 'resend') {
      configured = recipients.length > 0 && hasResend;
    }
    return { enabled, configured };
  }

  private whatsappConfigured(): { enabled: boolean; configured: boolean } {
    const enabled = truthy(this.config.get('whatsapp.enabled'));
    const configured = Boolean(
      this.config.get('whatsapp.accessToken') &&
      this.config.get('whatsapp.phoneNumberId') &&
      String(this.config.get('whatsapp.recipients') || '').trim(),
    );
    return { enabled, configured };
  }

  private publicStatus(
    enabled: boolean,
    configured: boolean,
    stored: { last_status?: unknown } | null,
  ): string {
    if (!enabled) return 'disabled';
    if (!configured) return 'failed';
    if (!stored || !stored.last_status) return 'unknown';
    const last = String(stored.last_status);
    if (last === 'ok' || last === 'skipped') return 'ok';
    if (last === 'failed') return 'failed';
    return 'unknown';
  }

  async buildStatusSnapshot() {
    const emailCfg = this.emailConfigured();
    const waCfg = this.whatsappConfigured();
    // New articles are emailed once per pipeline cycle, so none waits for email.
    const emailPending = 0;
    let waPending = 0;
    try {
      if (whatsappAlertsEnabled())
        waPending = await this.articles.countWhatsappPending();
    } catch {
      waPending = 0;
    }

    const stored = await this.statusStore.getAll();
    const emailStored = stored.email;
    const waStored = stored.whatsapp;

    const emailStatus = this.publicStatus(
      emailCfg.enabled,
      emailCfg.configured,
      emailStored,
    );
    let emailError: string | null = null;
    if (emailCfg.enabled && !emailCfg.configured) {
      emailError = 'missing_recipients_or_provider_credentials';
    } else if (emailStored && emailStored.last_status === 'failed') {
      emailError = emailStored.last_error
        ? String(emailStored.last_error)
        : null;
    }

    const waStatus = this.publicStatus(
      waCfg.enabled,
      waCfg.configured,
      waStored,
    );
    let waError: string | null = null;
    if (waCfg.enabled && !waCfg.configured) {
      waError = 'missing_token_phone_id_or_recipients';
    } else if (waStored && waStored.last_status === 'failed') {
      waError = waStored.last_error ? String(waStored.last_error) : null;
    }

    let lastDaily: Record<string, unknown> | null = null;
    try {
      const row = await this.dailyReports.latest();
      if (row) {
        lastDaily = {
          status: row.status ?? null,
          report_date: row.report_date ?? null,
          error: row.error ?? null,
          // Flask always emits sent_time (null when missing); JSON must keep the key.
          sent_time: row.sent_time ?? null,
        };
      }
    } catch {
      lastDaily = null;
    }

    return {
      email: {
        enabled: emailCfg.enabled,
        configured: emailCfg.configured,
        status: emailStatus,
        last_at: emailStored?.last_at ?? null,
        last_error: emailError,
        pending_articles: emailPending,
        last_daily_report: lastDaily,
      },
      whatsapp: {
        enabled: waCfg.enabled,
        configured: waCfg.configured,
        status: waStatus,
        last_at: waStored?.last_at ?? null,
        last_error: waError,
        pending_articles: waPending,
      },
    };
  }
}
