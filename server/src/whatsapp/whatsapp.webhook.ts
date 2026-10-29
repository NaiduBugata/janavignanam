import { Logger } from '@nestjs/common';
import { parseWebhookPayload, type WhatsAppEvent } from './whatsapp.parser';

const logger = new Logger('WhatsAppWebhook');
const EXPECTED_OBJECT = 'whatsapp_business_account';

export interface WebhookHttpResult {
  body: string;
  status: number;
}

export function webhookEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = (env.WHATSAPP_WEBHOOK_ENABLED ?? 'true').trim().toLowerCase();
  return ['1', 'true', 'yes', 'on'].includes(raw);
}

export function verifyWebhook(
  query: { mode?: string; token?: string; challenge?: string },
  env: NodeJS.ProcessEnv = process.env,
): WebhookHttpResult {
  if (!webhookEnabled(env)) return { body: 'Webhook disabled', status: 503 };
  const expected = (env.WHATSAPP_VERIFY_TOKEN || '').trim();
  if (
    query.mode === 'subscribe' &&
    query.token &&
    expected &&
    query.token === expected &&
    query.challenge != null
  ) {
    logger.log('WhatsApp webhook verification succeeded');
    return { body: String(query.challenge), status: 200 };
  }
  logger.warn('WhatsApp webhook verification failed');
  return { body: 'Forbidden', status: 403 };
}

export async function processWebhookPost(
  payload: unknown,
  options: {
    clientIp?: string | null;
    wabaId?: string;
    save: (event: WhatsAppEvent, raw: Record<string, unknown>) => Promise<void>;
  },
): Promise<WebhookHttpResult> {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    logger.error(
      `Invalid WhatsApp webhook JSON from ${options.clientIp || 'unknown'}`,
    );
    return { body: 'Invalid JSON payload', status: 400 };
  }
  const body = payload as Record<string, unknown>;
  if (body.object !== EXPECTED_OBJECT) {
    logger.warn(`Unexpected webhook object: ${String(body.object)}`);
  }
  const wabaId = (options.wabaId || '').trim();
  if (wabaId) {
    const entryIds = (Array.isArray(body.entry) ? body.entry : [])
      .filter(
        (entry) =>
          entry &&
          typeof entry === 'object' &&
          (entry as Record<string, unknown>).id != null,
      )
      .map((entry) => String((entry as Record<string, unknown>).id));
    if (entryIds.length && !entryIds.includes(wabaId)) {
      logger.warn(`WhatsApp WABA mismatch: expected ${wabaId}`);
    }
  }
  let events: WhatsAppEvent[];
  try {
    events = parseWebhookPayload(body);
  } catch (err) {
    logger.error(err instanceof Error ? err.message : String(err));
    return { body: 'Invalid JSON payload', status: 400 };
  }
  for (const event of events) {
    try {
      if (event.event_category === 'unknown')
        logger.warn(`Unknown WhatsApp event ${event.event_type}`);
      else
        logger.log(
          `WhatsApp ${event.event_category}/${event.event_type} id=${event.message_id || '-'}`,
        );
      await options.save(event, body);
    } catch (err) {
      logger.error(err instanceof Error ? err.message : String(err));
    }
  }
  return { body: 'EVENT_RECEIVED', status: 200 };
}
