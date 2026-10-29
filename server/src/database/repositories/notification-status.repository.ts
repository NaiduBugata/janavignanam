import { Injectable } from '@nestjs/common';
import { Document } from 'mongodb';
import { DatabaseService } from '../database.service';

const COLLECTION = 'notification_channel_status';

export interface ChannelStoredStatus {
  channel: string;
  enabled: unknown;
  last_status: unknown;
  last_error: unknown;
  last_at: unknown;
  last_notification_type: unknown;
  http_code: unknown;
}

@Injectable()
export class NotificationStatusRepository {
  constructor(private readonly db: DatabaseService) {}

  async get(channel: string): Promise<ChannelStoredStatus | null> {
    try {
      const doc = await this.db.collection(COLLECTION).findOne({
        _id: channel,
      });
      if (!doc) return null;
      return {
        channel: String(doc._id),
        enabled: doc.enabled,
        last_status: doc.last_status,
        last_error: doc.last_error,
        last_at: doc.last_at,
        last_notification_type: doc.last_notification_type,
        http_code: doc.http_code,
      };
    } catch {
      return null;
    }
  }

  async getAll(): Promise<{
    email: ChannelStoredStatus | null;
    whatsapp: ChannelStoredStatus | null;
  }> {
    return {
      email: await this.get('email'),
      whatsapp: await this.get('whatsapp'),
    };
  }

  async record(
    channel: 'email' | 'whatsapp',
    input: {
      status: string;
      enabled?: boolean;
      error?: string | null;
      notificationType?: string;
      httpCode?: number;
    },
  ): Promise<void> {
    const normalized =
      input.status === 'skipped'
        ? 'skipped'
        : ['ok', 'sent', 'partial', 'sent_text_fallback'].includes(input.status)
          ? 'ok'
          : 'failed';
    try {
      await this.db.ensureConnected();
      await this.db.collection(COLLECTION).updateOne(
        { _id: channel },
        {
          $set: {
            enabled: input.enabled !== false,
            last_status: normalized,
            last_error: input.error ? String(input.error).slice(0, 500) : null,
            last_at: new Date().toISOString(),
            last_notification_type: input.notificationType || null,
            http_code: input.httpCode ?? null,
          },
        },
        { upsert: true },
      );
    } catch {
      // Status history must not block delivery.
    }
  }
}
