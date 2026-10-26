import { alertRecipients, pipelineRecipients, staffDirectoryLoaded } from './whatsapp.audience';

const RECIPIENT = /^\d{8,15}$/;
const TEMPLATE_ERROR_CODES = new Set([132000, 132001, 132005, 132007, 132012, 132015, 132016]);
const RETRYABLE = new Set([429, 500, 502, 503, 504]);

export class WhatsAppSendError extends Error {
  statusCode?: number;
  metaErrorCode?: number;

  constructor(message: string, statusCode?: number, metaErrorCode?: number) {
    super(message);
    this.name = 'WhatsAppSendError';
    this.statusCode = statusCode;
    this.metaErrorCode = metaErrorCode;
  }
}

export interface WaSendResult {
  success: boolean;
  skipped: boolean;
  skip_reason?: string;
  error: string | null;
  messageId: string | null;
  attempts: number;
  httpCode?: number;
}

export function normalizePhone(recipient: string): string {
  const cleaned = recipient.trim().replace(/^\+/, '').replace(/[\s-]/g, '');
  if (!RECIPIENT.test(cleaned)) throw new Error(`Invalid WhatsApp recipient: ${JSON.stringify(recipient)}`);
  return cleaned;
}

export function whatsappReady(env: NodeJS.ProcessEnv = process.env): boolean {
  return ['1', 'true', 'yes', 'on'].includes((env.WHATSAPP_ENABLED || '').trim().toLowerCase())
    && Boolean((env.WHATSAPP_ACCESS_TOKEN || '').trim())
    && Boolean((env.WHATSAPP_PHONE_NUMBER_ID || '').trim())
    && Boolean((env.WHATSAPP_RECIPIENTS || '').trim());
}

/**
 * Automatic alerts (news, failures, summaries, health, startup). Off unless WHATSAPP_ALERTS_ENABLED=true:
 * those go by email. The WhatsApp menu bot replies through sendReplyList/sendTextMessage and is not affected.
 */
export function whatsappAlertsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return whatsappReady(env) && ['1', 'true', 'yes', 'on'].includes((env.WHATSAPP_ALERTS_ENABLED || '').trim().toLowerCase());
}

function graphUrl(env: NodeJS.ProcessEnv): string {
  const version = (env.META_API_VERSION || env.WHATSAPP_GRAPH_API_VERSION || 'v25.0').trim() || 'v25.0';
  const phoneId = (env.WHATSAPP_PHONE_NUMBER_ID || '').trim();
  if (!phoneId) throw new WhatsAppSendError('WHATSAPP_PHONE_NUMBER_ID is not configured');
  return `https://graph.facebook.com/${version}/${phoneId}/messages`;
}

function configuredRecipients(env: NodeJS.ProcessEnv): string[] {
  return (env.WHATSAPP_RECIPIENTS || '').split(',').map((item) => item.trim()).filter(Boolean);
}

/**
 * Pipeline success and failure go only to the super admin.
 * Other automatic alerts go to the super admin and the admins, not the MP.
 * Before the contact list has loaded, the configured recipient list is used so a restart still delivers.
 */
function recipients(env: NodeJS.ProcessEnv, audience?: 'pipeline' | 'staff'): string[] {
  if (!audience || !staffDirectoryLoaded()) return configuredRecipients(env);
  return audience === 'pipeline' ? pipelineRecipients() : alertRecipients();
}

function errorReason(status: number, data: Record<string, unknown>): string {
  const error = data.error && typeof data.error === 'object' ? (data.error as Record<string, unknown>) : {};
  const code = Number(error.code);
  const subcode = error.error_subcode;
  if (status === 401 || code === 190 || code === 102) return 'access_token_invalid_or_expired';
  if (status === 429 || code === 4) return 'rate_limited';
  if (status >= 500) return 'meta_server_error';
  if (subcode) return `meta_error_subcode_${String(subcode)}`;
  return 'meta_api_error';
}

async function postGraph(
  body: Record<string, unknown>,
  fetchImpl: typeof fetch,
  env: NodeJS.ProcessEnv,
): Promise<Record<string, unknown>> {
  if (!(env.WHATSAPP_ACCESS_TOKEN || '').trim()) throw new WhatsAppSendError('WHATSAPP_ACCESS_TOKEN is not configured');
  let response: Response;
  try {
    response = await fetchImpl(graphUrl(env), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new WhatsAppSendError(err instanceof Error ? err.message : String(err));
  }
  let data: Record<string, unknown> = {};
  try {
    data = (await response.json()) as Record<string, unknown>;
  } catch {
    throw new WhatsAppSendError(`Graph API returned non-JSON response (HTTP ${response.status})`, response.status);
  }
  if (!response.ok) {
    const error = data.error && typeof data.error === 'object' ? (data.error as Record<string, unknown>) : {};
    throw new WhatsAppSendError(
      `Graph API error ${response.status}: ${String(error.message || errorReason(response.status, data))}`,
      response.status,
      error.code != null ? Number(error.code) : undefined,
    );
  }
  return data;
}

export async function sendTextMessage(
  recipient: string,
  message: string,
  fetchImpl: typeof fetch = fetch,
  env: NodeJS.ProcessEnv = process.env,
): Promise<Record<string, unknown>> {
  if (!message.trim()) throw new Error('message must not be empty');
  return postGraph({
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: normalizePhone(recipient),
    type: 'text',
    text: { preview_url: false, body: message.trim() },
  }, fetchImpl, env);
}

export interface ReplyButton {
  id: string;
  title: string;
}

export interface MenuRow {
  id: string;
  title: string;
  description?: string;
}

/** A tappable list. Meta allows up to ten rows, each with a title and a short description. */
export async function sendReplyList(
  recipient: string,
  message: string,
  rows: MenuRow[],
  options: { button?: string; header?: string; section?: string; footer?: string; fetchImpl?: typeof fetch; env?: NodeJS.ProcessEnv } = {},
): Promise<Record<string, unknown>> {
  const body = message.trim();
  if (!body) throw new Error('message must not be empty');
  if (rows.length < 1 || rows.length > 10) throw new Error('list rows must be 1 to 10');
  return postGraph({
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: normalizePhone(recipient),
    type: 'interactive',
    interactive: {
      type: 'list',
      ...(options.header?.trim() ? { header: { type: 'text', text: options.header.trim().slice(0, 60) } } : {}),
      body: { text: body.slice(0, 1024) },
      footer: { text: (options.footer || 'Tap to select an item').trim().slice(0, 60) },
      action: {
        button: (options.button || 'Menu').trim().slice(0, 20),
        sections: [{
          ...(options.section?.trim() ? { title: options.section.trim().slice(0, 24) } : {}),
          rows: rows.map((row) => {
            const item: { id: string; title: string; description?: string } = {
              id: row.id.trim().slice(0, 200),
              title: row.title.trim().slice(0, 24),
            };
            const description = (row.description || '').trim().slice(0, 72);
            if (description) item.description = description;
            return item;
          }),
        }],
      },
    },
  }, options.fetchImpl || fetch, options.env || process.env);
}

/** Session reply buttons. Meta allows at most three per message, and none of them are links. */
export async function sendReplyButtons(
  recipient: string,
  message: string,
  buttons: ReplyButton[],
  fetchImpl: typeof fetch = fetch,
  env: NodeJS.ProcessEnv = process.env,
): Promise<Record<string, unknown>> {
  const body = message.trim();
  if (!body) throw new Error('message must not be empty');
  if (buttons.length < 1 || buttons.length > 3) throw new Error('reply buttons must be 1 to 3');
  return postGraph({
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: normalizePhone(recipient),
    type: 'interactive',
    interactive: {
      type: 'button',
      body: { text: body.slice(0, 1024) },
      action: {
        buttons: buttons.map((button) => ({
          type: 'reply',
          reply: {
            id: button.id.trim().slice(0, 256),
            title: button.title.trim().slice(0, 20),
          },
        })),
      },
    },
  }, fetchImpl, env);
}

export async function sendTemplateMessage(
  recipient: string,
  templateName: string,
  options: {
    language?: string;
    bodyParameters?: string[];
    /** For templates created with NAMED parameters, such as {{name}}. */
    namedParameters?: Record<string, string>;
    /** Suffix for the first website button, appended to the approved template URL. */
    urlButton?: string;
    fetchImpl?: typeof fetch;
    env?: NodeJS.ProcessEnv;
  } = {},
): Promise<Record<string, unknown>> {
  if (!templateName.trim()) throw new Error('template_name must not be empty');
  const parameters = options.namedParameters
    ? Object.entries(options.namedParameters).map(([name, value]) => ({ type: 'text', parameter_name: name, text: String(value).slice(0, 1024) }))
    : (options.bodyParameters || []).map((value) => ({ type: 'text', text: String(value).slice(0, 1024) }));
  const components: Array<Record<string, unknown>> = parameters.length ? [{ type: 'body', parameters }] : [];
  const urlButton = (options.urlButton || '').trim();
  if (urlButton) {
    components.push({
      type: 'button',
      sub_type: 'url',
      index: '0',
      parameters: [{ type: 'text', text: urlButton.slice(0, 1024) }],
    });
  }
  return postGraph({
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: normalizePhone(recipient),
    type: 'template',
    template: {
      name: templateName.trim(),
      language: { code: (options.language || 'en').trim() || 'en' },
      components,
    },
  }, options.fetchImpl || fetch, options.env || process.env);
}

function messageIdOf(data: Record<string, unknown>): string | null {
  const messages = data.messages;
  if (!Array.isArray(messages) || !messages.length) return null;
  const id = (messages[0] as Record<string, unknown>).id;
  return id ? String(id) : null;
}

function templateFailure(err: unknown): boolean {
  if (!(err instanceof WhatsAppSendError)) return false;
  if (err.metaErrorCode != null && TEMPLATE_ERROR_CODES.has(err.metaErrorCode)) return true;
  const text = err.message.toLowerCase();
  return text.includes('132001') || text.includes('template name does not exist') || text.includes('132000');
}

function useTemplates(env: NodeJS.ProcessEnv): boolean {
  const raw = (env.WHATSAPP_USE_TEMPLATES ?? 'true').trim().toLowerCase();
  return ['1', 'true', 'yes', 'on'].includes(raw);
}

function templateName(env: NodeJS.ProcessEnv): string {
  return (env.WHATSAPP_TEMPLATE_NAME || env.WHATSAPP_TEMPLATE_CRITICAL || 'mediasphere_critical_issue').trim();
}

export interface WhatsAppStatusUpdate {
  status: string;
  enabled: boolean;
  error: string | null;
  notificationType?: string;
  httpCode?: number;
}

let statusRecorder: ((update: WhatsAppStatusUpdate) => Promise<void>) | null = null;

/** Registered by the Nest module. Unit tests leave this unset so Mongo is never touched. */
export function setWhatsAppStatusRecorder(
  recorder: ((update: WhatsAppStatusUpdate) => Promise<void>) | null,
): void {
  statusRecorder = recorder;
}

async function sendOne(
  recipient: string,
  text: string,
  variables: string[],
  fetchImpl: typeof fetch,
  env: NodeJS.ProcessEnv,
  template: string,
): Promise<{ messageId: string | null; attempts: number }> {
  const maxAttempts = Math.max(1, Number(env.NOTIFICATION_MAX_RETRIES || '4'));
  const baseMs = Math.max(0, Number(env.NOTIFICATION_RETRY_BASE_SECONDS || '1')) * 1000;
  const language = (env.WHATSAPP_TEMPLATE_LANGUAGE || 'en_US').trim() || 'en_US';
  let attempts = 0;
  let last: unknown;
  const attemptSend = async (asText: boolean) => {
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      attempts = attempt;
      try {
        const data = asText
          ? await sendTextMessage(recipient, text, fetchImpl, env)
          : await sendTemplateMessage(recipient, template, { language, bodyParameters: variables, fetchImpl, env });
        return data;
      } catch (err) {
        last = err;
        const status = err instanceof WhatsAppSendError ? err.statusCode : undefined;
        const retryable = (status != null && RETRYABLE.has(status)) || String(err instanceof Error ? err.message : err).toLowerCase().includes('timed out');
        if (!retryable || attempt >= maxAttempts) throw err;
        if (baseMs) await new Promise((resolve) => setTimeout(resolve, baseMs * 2 ** (attempt - 1)));
      }
    }
    throw last;
  };
  try {
    const data = await attemptSend(!useTemplates(env));
    return { messageId: messageIdOf(data), attempts };
  } catch (err) {
    if (useTemplates(env) && templateFailure(err)) {
      const data = await sendTextMessage(recipient, text, fetchImpl, env);
      return { messageId: messageIdOf(data), attempts: attempts + 1 };
    }
    throw err;
  }
}

/** Send one notification to every configured recipient. Does nothing on the network when WhatsApp is off. */
export async function deliverWhatsApp(
  input: {
    text: string;
    variables?: string[];
    templateName?: string;
    notificationType?: string;
    /** pipeline: super admin only. staff: super admin and admins. */
    audience?: 'pipeline' | 'staff';
  },
  fetchImpl: typeof fetch = fetch,
  env: NodeJS.ProcessEnv = process.env,
): Promise<WaSendResult> {
  if (!whatsappReady(env)) {
    const skipped: WaSendResult = { success: true, skipped: true, skip_reason: 'whatsapp_disabled_or_misconfigured', error: null, messageId: null, attempts: 0 };
    await rememberStatus(skipped, input.notificationType, false);
    return skipped;
  }
  // News, health, and summaries stay on email. Pipeline success and failure still go to the super admin.
  if (!whatsappAlertsEnabled(env) && input.audience !== 'pipeline') {
    const skipped: WaSendResult = { success: true, skipped: true, skip_reason: 'whatsapp_alerts_off_email_only', error: null, messageId: null, attempts: 0 };
    await rememberStatus(skipped, input.notificationType, true);
    return skipped;
  }
  const targets = recipients(env, input.audience);
  if (!targets.length) {
    const skipped: WaSendResult = { success: true, skipped: true, skip_reason: 'no_recipients', error: null, messageId: null, attempts: 0 };
    await rememberStatus(skipped, input.notificationType, true);
    return skipped;
  }
  let anySuccess = false;
  let lastError: string | null = null;
  let messageId: string | null = null;
  let attempts = 0;
  for (const recipient of targets) {
    try {
      const sent = await sendOne(recipient, input.text, input.variables || [], fetchImpl, env, input.templateName || templateName(env));
      anySuccess = true;
      messageId = sent.messageId || messageId;
      attempts = sent.attempts;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }
  const result: WaSendResult = {
    success: anySuccess,
    skipped: false,
    error: anySuccess ? null : lastError,
    messageId,
    attempts,
    httpCode: anySuccess ? 200 : undefined,
  };
  await rememberStatus(result, input.notificationType, whatsappReady(env));
  return result;
}

async function rememberStatus(result: WaSendResult, notificationType: string | undefined, enabled: boolean): Promise<void> {
  if (!statusRecorder) return;
  const status = result.skipped ? 'skipped' : result.success ? 'ok' : 'failed';
  try {
    await statusRecorder({
      status,
      enabled,
      error: result.error || result.skip_reason || null,
      notificationType,
      httpCode: result.httpCode,
    });
  } catch {
    // Status history must not block delivery.
  }
}
