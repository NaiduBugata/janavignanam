import { sendReportEmail, type EmailSendResult } from '../reports/report-email';

export interface PipelineFailureEmail {
  reason: string;
  errors: readonly string[];
  at?: Date;
  fetchImpl?: typeof fetch;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function istStamp(at: Date): string {
  return at.toLocaleString('en-IN', {
    timeZone: process.env.REPORT_TIMEZONE || 'Asia/Kolkata',
    hour12: true,
  });
}

export function failureEmailContent(
  reason: string,
  errors: readonly string[],
  at: Date,
): { subject: string; html: string } {
  const stamp = istStamp(at);
  const details = errors
    .slice(0, 20)
    .map((error) => `<li><code>${escapeHtml(error.slice(0, 300))}</code></li>`)
    .join('');
  const more =
    errors.length > 20 ? `<p>…and ${errors.length - 20} more.</p>` : '';
  const dashboard = process.env.DASHBOARD_URL
    ? `<p><a href="${escapeHtml(process.env.DASHBOARD_URL)}">Open the dashboard</a></p>`
    : '';
  return {
    subject: `MediaSphere pipeline FAILED | ${stamp} IST`,
    html:
      `<h2>The automatic news pipeline failed</h2>` +
      `<p><strong>When:</strong> ${escapeHtml(stamp)} IST</p>` +
      `<p><strong>Problem:</strong> ${escapeHtml(reason)}</p>` +
      (details
        ? `<p><strong>Errors from this cycle:</strong></p><ul>${details}</ul>${more}`
        : '') +
      `<p>The same problem is emailed again only after ${escapeHtml(process.env.PIPELINE_ALERT_REPEAT_HOURS || '12')} hours, or at once if the problem changes.</p>` +
      dashboard,
  };
}

export async function sendPipelineFailureEmail(
  input: PipelineFailureEmail,
): Promise<EmailSendResult> {
  const { subject, html } = failureEmailContent(
    input.reason,
    input.errors,
    input.at || new Date(),
  );
  return sendReportEmail(
    subject,
    html,
    null,
    undefined,
    input.fetchImpl || fetch,
  );
}
