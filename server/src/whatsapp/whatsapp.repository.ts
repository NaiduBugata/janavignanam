import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import type { WhatsAppEvent } from './whatsapp.parser';

const COLLECTION = 'whatsapp_webhook_events';

function dedupKey(event: WhatsAppEvent): Record<string, unknown> {
  const key: Record<string, unknown> = {
    event_category: event.event_category,
    event_type: event.event_type,
  };
  if (event.message_id) key.message_id = event.message_id;
  if (event.status) key.status = event.status;
  if (event.sender_wa_id && !event.message_id)
    key.sender_wa_id = event.sender_wa_id;
  if (event.message_timestamp && !event.message_id)
    key.message_timestamp = event.message_timestamp;
  return key;
}

@Injectable()
export class WhatsAppWebhookRepository {
  private readonly logger = new Logger(WhatsAppWebhookRepository.name);

  constructor(private readonly db: DatabaseService) {}

  /** Upsert one webhook event. A database failure is logged and does not fail the Meta response. */
  async saveEvent(
    event: WhatsAppEvent,
    clientIp: string | null,
    rawPayload: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.db.ensureConnected();
      const now = new Date().toISOString();
      await this.db.collection(COLLECTION).updateOne(
        dedupKey(event),
        {
          $set: {
            ...event,
            client_ip: clientIp,
            raw_payload: rawPayload,
            received_at: now,
            updated_at: now,
          },
          $setOnInsert: { created_at: now },
        },
        { upsert: true },
      );
    } catch (err) {
      this.logger.error(
        `Failed to persist WhatsApp event message_id=${event.message_id || '-'}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
