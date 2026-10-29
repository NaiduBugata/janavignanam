export class EmailConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EmailConfigError';
  }
}

export interface EmailSendResult {
  channel: 'email';
  success: boolean;
  skipped: boolean;
  skip_reason?: string;
  error: string | null;
  attempts: number;
}

function enabled(): boolean {
  return ['1', 'true', 'yes', 'on'].includes(
    (process.env.EMAIL_ENABLED || '').trim().toLowerCase(),
  );
}

const EMAIL = /^[^@\s<>"',;[\]]+@[^@\s<>"',;[\]]+\.[^@\s<>"',;[\]]+$/;

/** Accepts `a@x.com,b@y.com`, `;` or space separators, and stray quotes, brackets, or `Name <a@x.com>` wrappers. */
export function parseRecipients(raw: string): {
  valid: string[];
  invalid: number;
} {
  const valid: string[] = [];
  let invalid = 0;
  for (const piece of raw.split(/[,;\s]+/)) {
    const angle = piece.match(/<([^>]+)>/);
    const item = (angle ? angle[1] : piece)
      .replace(/^[\s"'[\]<(]+|[\s"'[\]>)]+$/g, '')
      .replace(/^mailto:/i, '');
    if (!item) continue;
    if (EMAIL.test(item)) {
      if (!valid.includes(item)) valid.push(item);
    } else {
      invalid += 1;
    }
  }
  return { valid, invalid };
}

function recipientsOf(override?: string[]): string[] {
  const raw = override?.length
    ? override.join(',')
    : process.env.REPORT_RECIPIENTS || '';
  const { valid, invalid } = parseRecipients(raw);
  if (!valid.length && invalid) {
    throw new EmailConfigError(
      `REPORT_RECIPIENTS has no valid email address (${invalid} unreadable entr${invalid === 1 ? 'y' : 'ies'}). Use a@x.com,b@y.com.`,
    );
  }
  return valid;
}

function provider(): 'resend' | 'smtp' {
  const selected = (process.env.EMAIL_PROVIDER || 'auto').trim().toLowerCase();
  if (selected === 'resend') return 'resend';
  if (selected === 'smtp') return 'smtp';
  return process.env.RESEND_API_KEY?.trim() ? 'resend' : 'smtp';
}

function validate(kind: 'resend' | 'smtp', recipients: string[]): void {
  const missing: string[] = [];
  if (!recipients.length) missing.push('REPORT_RECIPIENTS');
  if (kind === 'resend') {
    if (!process.env.RESEND_API_KEY?.trim()) missing.push('RESEND_API_KEY');
    if (
      !(process.env.SMTP_FROM_EMAIL || process.env.SMTP_USERNAME || '').trim()
    ) {
      missing.push('SMTP_FROM_EMAIL');
    }
    if (missing.length)
      throw new EmailConfigError(
        `Missing Resend configuration: ${missing.join(', ')}`,
      );
    return;
  }
  if (!process.env.SMTP_HOST?.trim()) missing.push('SMTP_HOST');
  if (!process.env.SMTP_USERNAME?.trim()) missing.push('SMTP_USERNAME');
  if (!process.env.SMTP_PASSWORD?.trim()) missing.push('SMTP_PASSWORD');
  if (missing.length)
    throw new EmailConfigError(
      `Missing SMTP configuration: ${missing.join(', ')}`,
    );
  throw new EmailConfigError(
    'SMTP configuration is not used by the Nest report mailer. Set EMAIL_PROVIDER=resend.',
  );
}

/**
 * Send the daily report. Disabled email never opens a network connection.
 * SMTP is refused so this process cannot open a mail socket while Flask is still the sender.
 */
export async function sendReportEmail(
  subject: string,
  htmlBody: string,
  pdfPath: string | null,
  recipients: string[] | undefined,
  fetchImpl: typeof fetch,
): Promise<EmailSendResult> {
  if (!enabled()) {
    return {
      channel: 'email',
      success: false,
      skipped: true,
      skip_reason: 'email_disabled',
      error: null,
      attempts: 0,
    };
  }
  const kind = provider();
  const to = recipientsOf(recipients);
  validate(kind, to);
  const fromEmail = (
    process.env.SMTP_FROM_EMAIL ||
    process.env.SMTP_USERNAME ||
    ''
  ).trim();
  const fromName = process.env.SMTP_FROM_NAME || 'MediaSphere Intelligence';
  const maxAttempts = Math.max(1, Number(process.env.SMTP_MAX_RETRIES || '3'));
  const backoffMs =
    Math.max(0, Number(process.env.SMTP_RETRY_BACKOFF_SECONDS || '5')) * 1000;
  let lastError = 'unknown';
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const payload: Record<string, unknown> = {
        from: `${fromName} <${fromEmail}>`,
        to,
        subject,
        html: htmlBody,
      };
      if (pdfPath) {
        const { readFileSync, existsSync } = await import('node:fs');
        if (existsSync(pdfPath)) {
          payload.attachments = [
            {
              filename: pdfPath.split(/[\\/]/).pop(),
              content: readFileSync(pdfPath).toString('base64'),
            },
          ];
        }
      }
      const response = await fetchImpl('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Resend API ${response.status}: ${text.slice(0, 500)}`);
      }
      return {
        channel: 'email',
        success: true,
        skipped: false,
        error: null,
        attempts: attempt,
      };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      if (attempt < maxAttempts && backoffMs)
        await new Promise((resolve) =>
          setTimeout(resolve, backoffMs * attempt),
        );
    }
  }
  return {
    channel: 'email',
    success: false,
    skipped: false,
    error: lastError,
    attempts: maxAttempts,
  };
}
