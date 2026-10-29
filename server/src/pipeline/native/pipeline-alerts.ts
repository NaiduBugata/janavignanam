const AI_ERROR = /^(lokal|youtube|sakshi):[^:]+:/;

function kindOf(error: string): string {
  if (AI_ERROR.test(error) || error.startsWith('ai_failed='))
    return 'ai_failed';
  return error.split(/[:(]/)[0].trim();
}

/** Stable key for "the same problem again", so an unchanged failure is not re-alerted every hour. */
export function failureSignature(errors: readonly string[]): string {
  return [...new Set(errors.map(kindOf).filter(Boolean))].sort().join('|');
}

/** One readable line per problem, for WhatsApp and logs. */
export function describeFailure(errors: readonly string[]): string {
  const lines: string[] = [];
  const aiFailed = errors.filter((error) => AI_ERROR.test(error)).length;
  for (const error of errors) {
    if (AI_ERROR.test(error) || error.startsWith('ai_failed=')) continue;
    const blocked = error.match(/^youtube_blocked:(\d+)\/(\d+)\((.*)\)$/);
    const http = error.match(/^sakshi_http_(\d+)$/);
    if (blocked)
      lines.push(
        `YouTube refused captions to the server for ${blocked[1]} of ${blocked[2]} videos (${blocked[3]})`,
      );
    else if (http)
      lines.push(`Sakshi website refused the server (HTTP ${http[1]})`);
    else if (error === 'sakshi_no_links')
      lines.push(
        'Sakshi page had no article links; the page layout may have changed',
      );
    else if (error === 'sakshi_fetch_failed')
      lines.push('Sakshi website could not be reached');
    else if (error === 'youtube_missing_api_key')
      lines.push('YOUTUBE_API_KEY is not set');
    else lines.push(error);
  }
  if (aiFailed)
    lines.push(
      `AI analysis failed for ${aiFailed} article${aiFailed === 1 ? '' : 's'}`,
    );
  return [...new Set(lines)].join('; ') || 'non-zero exit';
}

/** Alerts on a new problem, then at most once per repeat window while it persists. */
export class FailureAlertGate {
  private last: { signature: string; at: number } | null = null;

  shouldAlert(
    errors: readonly string[],
    now: number,
    env: NodeJS.ProcessEnv = process.env,
  ): boolean {
    const signature = failureSignature(errors);
    const hours = Number(env.PIPELINE_ALERT_REPEAT_HOURS || '12');
    const repeatMs =
      (Number.isFinite(hours) && hours > 0 ? hours : 12) * 3_600_000;
    if (
      this.last &&
      this.last.signature === signature &&
      now - this.last.at < repeatMs
    )
      return false;
    this.last = { signature, at: now };
    return true;
  }

  clear(): void {
    this.last = null;
  }
}

/** On unless WHATSAPP_PIPELINE_STATUS is explicitly turned off. The super admin receives each clean run. */
export function pipelineStatusWhatsAppEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const raw = (env.WHATSAPP_PIPELINE_STATUS ?? 'true').trim().toLowerCase();
  return ['1', 'true', 'yes', 'on'].includes(raw);
}
