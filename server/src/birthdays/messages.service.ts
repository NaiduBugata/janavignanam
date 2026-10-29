import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import {
  sendTemplateMessage,
  sendTextMessage,
} from '../whatsapp/whatsapp.send';
import {
  maskPhone,
  whatsappSenderReady,
  type BirthdayContact,
} from './birthdays';
import { BirthdaysService } from './birthdays.service';
import {
  bestState,
  cleanParam,
  deliveryError,
  fetchSendableTemplates,
  fillTemplate,
  personalize,
  type DeliveryState,
  type SendableTemplate,
} from './messages';

const MESSAGES = 'contact_messages';
const TEMPLATE_CACHE_MS = 5 * 60 * 1000;
export const MAX_RECIPIENTS = 100;
const HISTORY = 100;

export interface SendInput {
  contactIds: string[];
  kind: 'text' | 'template';
  text?: string;
  template?: string;
  language?: string;
  params?: Record<string, string>;
}

export interface SendOutcome {
  contactId: string;
  name: string;
  status: 'accepted' | 'failed';
  error: string | null;
}

export interface SentMessage {
  id: string;
  contactId: string;
  name: string;
  phone: string;
  kind: 'text' | 'template';
  template: string | null;
  body: string;
  at: string;
  state: DeliveryState;
  error: string | null;
}

@Injectable()
export class ContactMessagesService {
  private readonly logger = new Logger(ContactMessagesService.name);
  private cache: { at: number; templates: SendableTemplate[] } | null = null;

  constructor(
    private readonly db: DatabaseService,
    private readonly birthdays: BirthdaysService,
  ) {}

  async templates(
    fetchImpl: typeof fetch = fetch,
  ): Promise<SendableTemplate[]> {
    if (this.cache && Date.now() - this.cache.at < TEMPLATE_CACHE_MS)
      return this.cache.templates;
    try {
      const templates = await fetchSendableTemplates(fetchImpl);
      this.cache = { at: Date.now(), templates };
      return templates;
    } catch (err) {
      throw new ServiceUnavailableException(
        err instanceof Error
          ? err.message
          : 'Could not load templates from Meta',
      );
    }
  }

  async send(
    input: SendInput,
    fetchImpl: typeof fetch = fetch,
  ): Promise<SendOutcome[]> {
    if (!whatsappSenderReady()) {
      throw new ServiceUnavailableException(
        'WhatsApp is not configured on the API (WHATSAPP_ENABLED, token, phone number ID).',
      );
    }
    const ids = [...new Set(input.contactIds || [])];
    if (!ids.length)
      throw new BadRequestException('Choose at least one person.');
    if (ids.length > MAX_RECIPIENTS)
      throw new BadRequestException(
        `Send to at most ${MAX_RECIPIENTS} people at a time.`,
      );
    const contacts = await this.birthdays.byIds(ids);
    if (!contacts.length)
      throw new BadRequestException(
        'None of the chosen people are in the contact list.',
      );

    const compose =
      input.kind === 'template'
        ? await this.templateComposer(input, fetchImpl)
        : this.textComposer(input, fetchImpl);
    const outcomes: SendOutcome[] = [];
    for (const contact of contacts) {
      const message = compose(contact);
      let messageId: string | null = null;
      let error: string | null = null;
      try {
        const data = await message.send();
        const first =
          Array.isArray(data.messages) && data.messages.length
            ? (data.messages[0] as Record<string, unknown>)
            : null;
        messageId = first?.id ? String(first.id) : null;
      } catch (err) {
        error = (err instanceof Error ? err.message : String(err)).slice(
          0,
          300,
        );
        this.logger.error(
          `[ADMIN_MESSAGE] failed for ${maskPhone(contact.phone)}: ${error}`,
        );
      }
      await this.db.collection(MESSAGES).insertOne({
        contactId: contact.id,
        name: contact.name,
        phone: contact.phone,
        kind: input.kind,
        template: input.kind === 'template' ? input.template : null,
        body: message.body.slice(0, 4096),
        messageId,
        status: error ? 'failed' : 'accepted',
        error,
        at: new Date().toISOString(),
      });
      outcomes.push({
        contactId: contact.id,
        name: contact.name,
        status: error ? 'failed' : 'accepted',
        error,
      });
    }
    this.logger.log(
      `[ADMIN_MESSAGE] ${input.kind}: accepted=${outcomes.filter((o) => o.status === 'accepted').length} failed=${outcomes.filter((o) => o.status === 'failed').length}`,
    );
    return outcomes;
  }

  /** Newest first, with the delivery state from Meta's receipts stored by the webhook. */
  async history(): Promise<SentMessage[]> {
    if (!(await this.db.ensureConnected()))
      throw new ServiceUnavailableException('Database is not connected');
    const rows = (await this.db.collection(MESSAGES).find({}).toArray())
      .sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')))
      .slice(0, HISTORY);
    const ids = rows
      .map((row) => row.messageId)
      .filter(Boolean)
      .map(String);
    const receipts = ids.length
      ? await this.db.query<{ id: string; status: string; errors: unknown }>(
          `SELECT doc->>'message_id' AS id, doc->>'status' AS status, doc->'error_codes' AS errors
           FROM mediasphere.documents
          WHERE collection = 'whatsapp_webhook_events'
            AND doc->>'event_category' = 'status'
            AND doc->>'message_id' = ANY($1::text[])`,
          [ids],
        )
      : [];
    return rows.map((row) => {
      const mine = receipts.filter((receipt) => receipt.id === row.messageId);
      const failedReceipt = mine.find((receipt) => receipt.status === 'failed');
      const state: DeliveryState =
        row.status === 'failed'
          ? 'failed'
          : bestState(mine.map((receipt) => receipt.status));
      return {
        id: String(row._id),
        contactId: String(row.contactId || ''),
        name: String(row.name || ''),
        phone: String(row.phone || ''),
        kind: row.kind === 'template' ? 'template' : 'text',
        template: row.template ? String(row.template) : null,
        body: String(row.body || ''),
        at: String(row.at || ''),
        state,
        error:
          row.status === 'failed'
            ? String(row.error || 'Meta refused the message')
            : failedReceipt
              ? deliveryError(failedReceipt.errors)
              : null,
      };
    });
  }

  private textComposer(input: SendInput, fetchImpl: typeof fetch) {
    const text = String(input.text || '').trim();
    if (!text) throw new BadRequestException('Type a message.');
    if (text.length > 4000)
      throw new BadRequestException(
        'A WhatsApp message can be at most 4000 characters.',
      );
    return (contact: BirthdayContact) => {
      const body = personalize(text, contact.name);
      return {
        body,
        send: () => sendTextMessage(contact.phone, body, fetchImpl),
      };
    };
  }

  private async templateComposer(input: SendInput, fetchImpl: typeof fetch) {
    const template = (await this.templates(fetchImpl)).find(
      (t) =>
        t.name === input.template &&
        (!input.language || t.language === input.language),
    );
    if (!template)
      throw new BadRequestException('Choose one of the approved templates.');
    const given: Record<string, string> = {};
    for (const key of template.params)
      given[key] = cleanParam(input.params?.[key]);
    const missing = template.params.filter(
      (key) => !given[key] && key !== 'name',
    );
    if (missing.length)
      throw new BadRequestException(
        `Fill in: ${missing.map((key) => `{{${key}}}`).join(', ')}`,
      );
    return (contact: BirthdayContact) => {
      const values = { ...given };
      if (template.params.includes('name') && !values.name)
        values.name = cleanParam(contact.name);
      const body =
        fillTemplate(template.body, values) +
        (template.footer ? `\n\n${template.footer}` : '');
      const ordered = [...template.params].sort(
        (a, b) => Number(a) - Number(b),
      );
      return {
        body,
        send: () =>
          sendTemplateMessage(
            contact.phone,
            template.name,
            template.named
              ? {
                  language: template.language,
                  namedParameters: Object.fromEntries(
                    template.params.map((key) => [key, values[key]]),
                  ),
                  fetchImpl,
                }
              : {
                  language: template.language,
                  bodyParameters: ordered.map((key) => values[key]),
                  fetchImpl,
                },
          ),
      };
    };
  }
}
