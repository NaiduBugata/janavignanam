import {
  articleAlertText,
  articleTemplateVariables,
  failureText,
  healthText,
  isCriticalArticle,
  pipelineStatusText,
  summaryText,
  summaryVariables,
} from './whatsapp.messages';
import { pipelineRecipients, staffDirectoryLoaded } from './whatsapp.audience';
import { parseWebhookPayload } from './whatsapp.parser';
import {
  deliverWhatsApp,
  sendTextMessage,
  whatsappAlertsEnabled,
  whatsappReady,
  type WaSendResult,
} from './whatsapp.send';

export interface WhatsAppNotice extends WaSendResult {
  notification_type: string;
}

export interface PendingDeps {
  findPending: () => Promise<Array<Record<string, unknown>>>;
  markSent: (
    postId: string,
    messageId: string | null,
    critical: boolean,
  ) => Promise<void>;
  fetchImpl?: typeof fetch;
  criticalOnly?: boolean;
}

type TemplateKind =
  'article' | 'critical' | 'daily' | 'pipeline' | 'failure' | 'system';

function notice(type: string, result: WaSendResult): WhatsAppNotice {
  return { ...result, notification_type: type };
}

function forced(env: NodeJS.ProcessEnv = process.env): boolean {
  return ['1', 'true', 'yes', 'on'].includes(
    (env.WHATSAPP_FORCE_SINGLE_TEMPLATE ?? 'true').trim().toLowerCase(),
  );
}

function templateFor(
  kind: TemplateKind,
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (forced(env)) {
    return (
      env.WHATSAPP_TEMPLATE_NAME ||
      env.WHATSAPP_TEMPLATE_CRITICAL ||
      'mediasphere_critical_issue'
    ).trim();
  }
  const names: Record<TemplateKind, string> = {
    article: (
      env.WHATSAPP_TEMPLATE_ARTICLE_ALERT ||
      env.WHATSAPP_TEMPLATE_ARTICLE ||
      'mediasphere_article_alert'
    ).trim(),
    critical: (
      env.WHATSAPP_TEMPLATE_CRITICAL || 'mediasphere_critical_issue'
    ).trim(),
    daily: (env.WHATSAPP_TEMPLATE_DAILY || 'mediasphere_daily_summary').trim(),
    pipeline: (
      env.WHATSAPP_TEMPLATE_PIPELINE || 'mediasphere_pipeline_status'
    ).trim(),
    failure: (
      env.WHATSAPP_TEMPLATE_FAILURE || 'mediasphere_failure_alert'
    ).trim(),
    system: (
      env.WHATSAPP_TEMPLATE_SYSTEM || 'mediasphere_system_status'
    ).trim(),
  };
  return names[kind];
}

async function send(
  type: string,
  kind: TemplateKind,
  text: string,
  variables: string[] | undefined,
  fetchImpl: typeof fetch = fetch,
  audience: 'pipeline' | 'staff' = 'staff',
): Promise<WhatsAppNotice> {
  const vars = forced()
    ? variables && variables.length === 5
      ? variables
      : summaryVariables(text)
    : variables || summaryVariables(text);
  return notice(
    type,
    await deliverWhatsApp(
      {
        text,
        variables: vars,
        templateName: templateFor(kind),
        notificationType: type,
        audience,
      },
      fetchImpl,
    ),
  );
}

export async function notifyArticleWhatsApp(
  article: Record<string, unknown>,
  fetchImpl: typeof fetch = fetch,
): Promise<WhatsAppNotice> {
  const critical = isCriticalArticle(article);
  return send(
    critical ? 'critical_issue' : 'article_alert',
    critical ? 'critical' : 'article',
    articleAlertText(article),
    articleTemplateVariables(article),
    fetchImpl,
  );
}

export async function notifyCriticalWhatsApp(
  article: Record<string, unknown>,
  fetchImpl: typeof fetch = fetch,
): Promise<WhatsAppNotice | { status: 'skipped'; reason: 'not_critical' }> {
  if (!isCriticalArticle(article))
    return { status: 'skipped', reason: 'not_critical' };
  return send(
    'critical_issue',
    'critical',
    articleAlertText(article),
    articleTemplateVariables(article),
    fetchImpl,
  );
}

export async function notifyDailyWhatsApp(
  stats: Record<string, unknown>,
  reportDate: string,
  fetchImpl: typeof fetch = fetch,
): Promise<WhatsAppNotice> {
  const text = summaryText(stats, reportDate);
  const problems =
    stats.problem_count || stats.problems || stats.high_priority_problems || 0;
  const variables = [
    reportDate,
    String(stats.total || stats.article_count || 0),
    String(stats.positive_count || stats.positive || 0),
    String(stats.negative_count || stats.negative || 0),
    String(problems),
    process.env.DASHBOARD_URL || 'N/A',
  ];
  return send(
    'daily_summary',
    'daily',
    text,
    forced() ? summaryVariables(text) : variables,
    fetchImpl,
  );
}

export async function notifyPipelineWhatsApp(
  stats: Record<string, unknown>,
  fetchImpl: typeof fetch = fetch,
): Promise<WhatsAppNotice> {
  const text = pipelineStatusText(stats);
  const variables = [
    String(stats.inserted || 0),
    String(stats.articles_fetched || stats.fetched || 0),
    String(stats.duration_seconds ?? '—'),
    String(stats.status || 'ok'),
  ];
  return send(
    'pipeline_complete',
    'pipeline',
    text,
    forced() ? summaryVariables(text) : variables,
    fetchImpl,
    'pipeline',
  );
}

export async function notifyFailureWhatsApp(
  module: string,
  reason: string,
  retryStatus = 'N/A',
  fetchImpl: typeof fetch = fetch,
): Promise<WhatsAppNotice> {
  const text = failureText(module, reason, retryStatus);
  return send(
    'failure',
    'failure',
    text,
    [module, reason.slice(0, 200), new Date().toISOString()],
    fetchImpl,
    'pipeline',
  );
}

export async function notifyHealthWhatsApp(
  checks: Record<string, string>,
  fetchImpl: typeof fetch = fetch,
): Promise<WhatsAppNotice> {
  const text = healthText(checks);
  return send(
    'health',
    'system',
    text,
    [
      'HEALTH',
      process.env.APP_ENVIRONMENT || 'production',
      process.env.APP_VERSION || '0',
      new Date().toISOString(),
    ],
    fetchImpl,
  );
}

export async function notifyStartupWhatsApp(
  fetchImpl: typeof fetch = fetch,
): Promise<WhatsAppNotice> {
  const text = [
    'MediaSphere Started',
    `Environment: ${process.env.APP_ENVIRONMENT || 'production'}`,
    `Version: ${process.env.APP_VERSION || '0'}`,
    'Collectors Loaded: yes',
    'Scheduler: configured',
    'Mongo Connected: warming',
    'Notification Services: ready',
    'MediaSphere Intelligence Platform',
  ].join('\n');
  return send(
    'startup',
    'system',
    text,
    [
      'STARTED',
      process.env.APP_ENVIRONMENT || 'production',
      process.env.APP_VERSION || '0',
      new Date().toISOString(),
    ],
    fetchImpl,
  );
}

export async function notifyShutdownWhatsApp(
  fetchImpl: typeof fetch = fetch,
): Promise<WhatsAppNotice> {
  const text = [
    'MediaSphere Shutting Down',
    `Environment: ${process.env.APP_ENVIRONMENT || 'production'}`,
    `Version: ${process.env.APP_VERSION || '0'}`,
    'Graceful shutdown initiated.',
    'MediaSphere Intelligence Platform',
  ].join('\n');
  return send(
    'shutdown',
    'system',
    text,
    [
      'SHUTDOWN',
      process.env.APP_ENVIRONMENT || 'production',
      process.env.APP_VERSION || '0',
      new Date().toISOString(),
    ],
    fetchImpl,
  );
}

export async function notifyCustomWhatsApp(
  text: string,
  fetchImpl: typeof fetch = fetch,
): Promise<WhatsAppNotice> {
  return send('custom', 'system', text, undefined, fetchImpl);
}

/**
 * Flask notify_new_article() with no article: every document still marked
 * whatsapp_sent=false. Critical rows use the critical wording. Does not query
 * Mongo unless WhatsApp is configured and findPending is invoked by the caller.
 */
export async function notifyPendingWhatsApp(
  deps: PendingDeps,
): Promise<WhatsAppNotice & { sent: number; failed: number }> {
  if (!whatsappReady()) {
    return {
      ...notice('article_alert', {
        success: true,
        skipped: true,
        skip_reason: 'whatsapp_disabled_or_misconfigured',
        error: null,
        messageId: null,
        attempts: 0,
      }),
      sent: 0,
      failed: 0,
    };
  }
  if (!whatsappAlertsEnabled()) {
    return {
      ...notice('article_alert', {
        success: true,
        skipped: true,
        skip_reason: 'whatsapp_alerts_off_email_only',
        error: null,
        messageId: null,
        attempts: 0,
      }),
      sent: 0,
      failed: 0,
    };
  }
  const docs = await deps.findPending();
  if (!docs.length) {
    return {
      ...notice('article_alert', {
        success: true,
        skipped: true,
        skip_reason: 'no_pending_articles',
        error: null,
        messageId: null,
        attempts: 0,
      }),
      sent: 0,
      failed: 0,
    };
  }
  let sent = 0;
  let failed = 0;
  let messageId: string | null = null;
  for (const doc of docs) {
    const critical = isCriticalArticle(doc);
    if (deps.criticalOnly && !critical) continue;
    const result = await notifyArticleWhatsApp(doc, deps.fetchImpl || fetch);
    const postId = doc.post_id ? String(doc.post_id) : '';
    if (result.success && !result.skipped) {
      sent += 1;
      messageId = result.messageId || messageId;
      if (postId) await deps.markSent(postId, result.messageId, critical);
    } else {
      failed += 1;
    }
  }
  return {
    notification_type: 'article_alert',
    success: failed === 0,
    skipped: sent === 0 && failed === 0,
    skip_reason: sent === 0 && failed === 0 ? 'no_pending_articles' : undefined,
    error: failed ? `${failed}_failed` : null,
    messageId,
    attempts: sent + failed,
    sent,
    failed,
  };
}

const toldFailures = new Set<string>();

/** A session message to Sarojininaidu only. Skipped until the contact list has loaded. */
export async function notifySuperAdminText(
  text: string,
  fetchImpl: typeof fetch = fetch,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  if (!staffDirectoryLoaded()) return;
  const body = text.trim().slice(0, 1000);
  if (!body) return;
  for (const phone of pipelineRecipients()) {
    try {
      await sendTextMessage(phone, body, fetchImpl, env);
    } catch {
      // A missed notice must not stop the reply that caused it.
    }
  }
}

/** One notice per failed delivery, so a webhook retry does not repeat it. */
export async function notifyFailedStatuses(
  payload: unknown,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  if (!payload || typeof payload !== 'object') return;
  let events: ReturnType<typeof parseWebhookPayload> = [];
  try {
    events = parseWebhookPayload(payload as Record<string, unknown>);
  } catch {
    return;
  }
  for (const event of events) {
    if (
      event.event_category !== 'status' ||
      event.status !== 'failed' ||
      !event.message_id
    )
      continue;
    if (toldFailures.has(event.message_id)) continue;
    if (toldFailures.size > 500) toldFailures.clear();
    toldFailures.add(event.message_id);
    const digits = String(event.sender_wa_id || '').replace(/\D/g, '');
    const tail = digits.length >= 2 ? digits.slice(-2) : '';
    const reason = event.error_codes[0]?.title
      ? String(event.error_codes[0].title)
      : 'delivery failed';
    await notifySuperAdminText(
      `A WhatsApp message failed${tail ? ` for a number ending ${tail}` : ''}. ${reason}`.slice(
        0,
        300,
      ),
      fetchImpl,
    );
  }
}
