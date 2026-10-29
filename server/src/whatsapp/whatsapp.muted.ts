import { replyRecipients, staffDirectoryLoaded } from './whatsapp.audience';

/**
 * Numbers that only receive one-way messages (birthday wishes). Their incoming messages are dropped
 * before the webhook stores them or the chatbot sees them, even when the number is on WHATSAPP_RECIPIENTS.
 * A contact with replies allowed is in `contacts` but not in `muted`.
 * Admin and super admin numbers are never dropped, including while visit or birthday messages are sending.
 */
let muted = new Set<string>();
let contacts = new Set<string>();
let inboundRecorder: ((numbers: string[]) => Promise<void>) | null = null;

function digits(value: unknown): string {
  return String(value ?? '').replace(/\D/g, '');
}

export function setMutedSenders(
  numbers: Iterable<string>,
  allContacts: Iterable<string> = numbers,
): void {
  muted = new Set([...numbers].map(digits).filter(Boolean));
  contacts = new Set([...allContacts].map(digits).filter(Boolean));
}

/**
 * Told which contacts just wrote in (never what they wrote), so the admin page knows
 * whether WhatsApp's 24-hour window for free text is open.
 */
export function setContactInboundRecorder(
  recorder: ((numbers: string[]) => Promise<void>) | null,
): void {
  inboundRecorder = recorder;
}

/** Contact numbers that sent a message in this webhook payload, muted or not. */
export function contactSenders(payload: unknown): string[] {
  if (!contacts.size || !payload || typeof payload !== 'object') return [];
  const found = new Set<string>();
  for (const entry of Array.isArray((payload as Record<string, unknown>).entry)
    ? ((payload as Record<string, unknown>).entry as unknown[])
    : []) {
    const changes =
      entry && typeof entry === 'object'
        ? (entry as Record<string, unknown>).changes
        : null;
    for (const change of Array.isArray(changes) ? changes : []) {
      const value =
        change && typeof change === 'object'
          ? (change as Record<string, unknown>).value
          : null;
      const messages =
        value && typeof value === 'object'
          ? (value as Record<string, unknown>).messages
          : null;
      for (const message of Array.isArray(messages) ? messages : []) {
        const from = digits(
          message && typeof message === 'object'
            ? (message as Record<string, unknown>).from
            : '',
        );
        if (contacts.has(from)) found.add(from);
      }
    }
  }
  return [...found];
}

export async function noteContactInbound(numbers: string[]): Promise<void> {
  if (!inboundRecorder || !numbers.length) return;
  try {
    await inboundRecorder([...new Set(numbers)]);
  } catch {
    // Bookkeeping only; the webhook answer must not depend on it.
  }
}

export function isMutedSender(waId: unknown): boolean {
  const phone = digits(waId);
  if (!phone) return false;
  if (staffDirectoryLoaded() && replyRecipients().includes(phone)) return false;
  return muted.has(phone);
}

/**
 * Copy of a webhook payload without messages (and contact names) from muted numbers. Delivery statuses stay.
 * A change or entry left with nothing in it is removed, so nothing is stored for it.
 */
export function withoutMutedMessages(payload: unknown): {
  payload: unknown;
  dropped: number;
  from: string[];
} {
  if (
    !muted.size ||
    !payload ||
    typeof payload !== 'object' ||
    !Array.isArray((payload as Record<string, unknown>).entry)
  ) {
    return { payload, dropped: 0, from: [] };
  }
  let dropped = 0;
  const from: string[] = [];
  const body = payload as Record<string, unknown>;
  const entries = (body.entry as unknown[])
    .map((entry) => {
      if (
        !entry ||
        typeof entry !== 'object' ||
        !Array.isArray((entry as Record<string, unknown>).changes)
      )
        return entry;
      const row = entry as Record<string, unknown>;
      const changes = (row.changes as unknown[])
        .map((change) => {
          const value =
            change && typeof change === 'object'
              ? (change as Record<string, unknown>).value
              : null;
          if (
            !value ||
            typeof value !== 'object' ||
            !Array.isArray((value as Record<string, unknown>).messages)
          )
            return change;
          const original = value as Record<string, unknown>;
          const messages = (original.messages as unknown[]).filter(
            (message) => {
              const hit =
                message &&
                typeof message === 'object' &&
                isMutedSender((message as Record<string, unknown>).from);
              if (hit) {
                dropped += 1;
                from.push(digits((message as Record<string, unknown>).from));
              }
              return !hit;
            },
          );
          if (messages.length === (original.messages as unknown[]).length)
            return change;
          const next: Record<string, unknown> = { ...original, messages };
          if (Array.isArray(original.contacts)) {
            next.contacts = original.contacts.filter(
              (contact) =>
                !(
                  contact &&
                  typeof contact === 'object' &&
                  isMutedSender((contact as Record<string, unknown>).wa_id)
                ),
            );
          }
          const hasContent =
            messages.length > 0 ||
            (Array.isArray(next.statuses) && next.statuses.length > 0) ||
            Boolean(next.message_template_status_update) ||
            (Array.isArray(next.errors) && next.errors.length > 0);
          return hasContent
            ? { ...(change as Record<string, unknown>), value: next }
            : null;
        })
        .filter((change) => change !== null);
      return changes.length ? { ...row, changes } : null;
    })
    .filter((entry) => entry !== null);
  return {
    payload: dropped ? { ...body, entry: entries } : payload,
    dropped,
    from,
  };
}
