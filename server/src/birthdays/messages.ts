const PARAM = /\{\{\s*(\w+)\s*\}\}/g;
/** System alert and Meta sample templates are not offered for messages to people. */
const HIDDEN_PREFIXES = ['mediasphere_', 'hello_world', '3p_'];

export interface SendableTemplate {
  name: string;
  language: string;
  category: string;
  body: string;
  footer: string;
  /** In the order they appear in the body. */
  params: string[];
  named: boolean;
}

function graphVersion(env: NodeJS.ProcessEnv): string {
  return (
    (
      env.META_API_VERSION ||
      env.WHATSAPP_GRAPH_API_VERSION ||
      'v25.0'
    ).trim() || 'v25.0'
  );
}

export function paramsOf(text: string): string[] {
  return [...new Set([...text.matchAll(PARAM)].map((m) => m[1]))];
}

/**
 * Approved templates this page can fill in: variables only in the body. Templates with media headers
 * or variables in the header or button links need extra inputs and are left out.
 */
export function sendableTemplates(rows: unknown[]): SendableTemplate[] {
  const result: SendableTemplate[] = [];
  for (const raw of rows) {
    const row = (raw || {}) as Record<string, unknown>;
    const name = String(row.name || '');
    if (
      row.status !== 'APPROVED' ||
      !name ||
      HIDDEN_PREFIXES.some((prefix) => name.startsWith(prefix))
    )
      continue;
    const components = Array.isArray(row.components)
      ? (row.components as Array<Record<string, unknown>>)
      : [];
    const body = components.find((c) => c.type === 'BODY');
    if (!body?.text) continue;
    const header = components.find((c) => c.type === 'HEADER');
    if (
      header &&
      (header.format !== 'TEXT' || paramsOf(String(header.text || '')).length)
    )
      continue;
    const buttons = components.find((c) => c.type === 'BUTTONS');
    const buttonVars =
      Array.isArray(buttons?.buttons) &&
      (buttons.buttons as Array<Record<string, unknown>>).some(
        (b) => paramsOf(String(b.url || '')).length,
      );
    if (buttonVars) continue;
    const footer = components.find((c) => c.type === 'FOOTER');
    const text = String(body.text);
    result.push({
      name,
      language: String(row.language || 'en'),
      category: String(row.category || ''),
      body: header?.text ? `${String(header.text)}\n\n${text}` : text,
      footer: footer?.text ? String(footer.text) : '',
      params: paramsOf(text),
      named:
        row.parameter_format === 'NAMED' ||
        paramsOf(text).some((p) => !/^\d+$/.test(p)),
    });
  }
  return result.sort(
    (a, b) =>
      a.name.localeCompare(b.name) || a.language.localeCompare(b.language),
  );
}

export async function fetchSendableTemplates(
  fetchImpl: typeof fetch = fetch,
  env: NodeJS.ProcessEnv = process.env,
): Promise<SendableTemplate[]> {
  const waba = (
    env.WHATSAPP_WABA_ID ||
    env.WHATSAPP_BUSINESS_ACCOUNT_ID ||
    ''
  ).trim();
  const token = (env.WHATSAPP_ACCESS_TOKEN || '').trim();
  if (!waba || !token)
    throw new Error(
      'WHATSAPP_WABA_ID and WHATSAPP_ACCESS_TOKEN are needed to list templates.',
    );
  const url = `https://graph.facebook.com/${graphVersion(env)}/${waba}/message_templates?fields=name,status,category,language,parameter_format,components&limit=200`;
  const response = await fetchImpl(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = (await response.json().catch(() => ({}))) as {
    data?: unknown[];
    error?: { message?: string };
  };
  if (!response.ok)
    throw new Error(
      `Meta refused the template list: ${data.error?.message || `HTTP ${response.status}`}`,
    );
  return sendableTemplates(data.data || []);
}

/** Meta refuses template values with line breaks, tabs, or more than four spaces in a row. */
export function cleanParam(value: unknown): string {
  return String(value ?? '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/ {4,}/g, '   ')
    .trim()
    .slice(0, 1024);
}

export function fillTemplate(
  body: string,
  values: Record<string, string>,
): string {
  return body.replace(PARAM, (whole, key: string) =>
    values[key] ? values[key] : whole,
  );
}

/** "{name}" in a typed message becomes each person's name. */
export function personalize(text: string, name: string): string {
  return text.replace(/\{name\}/gi, name);
}

export type DeliveryState =
  'accepted' | 'sent' | 'delivered' | 'read' | 'failed';

const RANK: Record<string, number> = {
  accepted: 0,
  sent: 1,
  delivered: 2,
  read: 3,
  failed: 4,
};

/** Latest meaningful state from Meta's receipts; a failure outranks everything. */
export function bestState(states: string[]): DeliveryState {
  return states.reduce<DeliveryState>(
    (best, state) =>
      (RANK[state] ?? -1) > RANK[best] ? (state as DeliveryState) : best,
    'accepted',
  );
}

export function deliveryError(errors: unknown): string {
  const first =
    Array.isArray(errors) && errors.length
      ? (errors[0] as Record<string, unknown>)
      : null;
  if (!first) return 'WhatsApp could not deliver the message.';
  const code = Number(first.code);
  if (code === 131047)
    return 'Not delivered: this person has not messaged in the last 24 hours, so WhatsApp only allows an approved template.';
  if (code === 131026)
    return 'Not delivered: the number is not on WhatsApp or cannot receive this message.';
  if (code === 131049)
    return 'Not delivered: Meta is limiting marketing messages to this person. Try again later.';
  if (code === 131050)
    return 'Not delivered: this person has stopped marketing messages from the business.';
  return `Not delivered: ${String(first.title || first.message || `error ${code}`)}`;
}
