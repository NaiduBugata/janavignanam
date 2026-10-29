const KNOWN_MESSAGE_TYPES = new Set([
  'text',
  'image',
  'document',
  'audio',
  'video',
  'sticker',
  'interactive',
  'button',
  'contacts',
  'location',
  'reaction',
  'order',
  'system',
  'unknown',
]);
const KNOWN_STATUS_VALUES = new Set(['sent', 'delivered', 'read', 'failed']);

export interface WhatsAppEvent {
  event_category: string;
  event_type: string;
  waba_id: string | null;
  phone_number_id: string | null;
  display_phone_number: string | null;
  change_field: string | null;
  sender_wa_id: string | null;
  sender_profile_name: string | null;
  message_id: string | null;
  message_timestamp: string | null;
  message_text: string | null;
  status: string | null;
  error_codes: Array<Record<string, unknown>>;
  media_ids: string[];
  interactive_response: Record<string, unknown> | null;
  template_status: Record<string, unknown> | null;
  raw_change: Record<string, unknown>;
}

function baseEvent(
  eventCategory: string,
  eventType: string,
  wabaId: string | null,
  metadata: Record<string, unknown>,
  changeField: string | null,
  rawChange: Record<string, unknown>,
): WhatsAppEvent {
  return {
    event_category: eventCategory,
    event_type: eventType,
    waba_id: wabaId,
    phone_number_id: metadata.phone_number_id
      ? String(metadata.phone_number_id)
      : null,
    display_phone_number: metadata.display_phone_number
      ? String(metadata.display_phone_number)
      : null,
    change_field: changeField,
    sender_wa_id: null,
    sender_profile_name: null,
    message_id: null,
    message_timestamp: null,
    message_text: null,
    status: null,
    error_codes: [],
    media_ids: [],
    interactive_response: null,
    template_status: null,
    raw_change: rawChange,
  };
}

function contactMap(contacts: unknown): Record<string, string> {
  const mapping: Record<string, string> = {};
  if (!Array.isArray(contacts)) return mapping;
  for (const contact of contacts) {
    if (!contact || typeof contact !== 'object') continue;
    const row = contact as Record<string, unknown>;
    const profile =
      row.profile && typeof row.profile === 'object'
        ? (row.profile as Record<string, unknown>)
        : {};
    if (row.wa_id)
      mapping[String(row.wa_id)] = profile.name ? String(profile.name) : '';
  }
  return mapping;
}

function parseMessage(
  message: Record<string, unknown>,
  wabaId: string | null,
  metadata: Record<string, unknown>,
  contacts: Record<string, string>,
  changeField: string | null,
  rawChange: Record<string, unknown>,
): WhatsAppEvent {
  const msgType = String(message.type || 'unknown');
  const sender = String(message.from || '');
  const event = baseEvent(
    'message',
    KNOWN_MESSAGE_TYPES.has(msgType) ? msgType : 'unknown',
    wabaId,
    metadata,
    changeField,
    rawChange,
  );
  event.sender_wa_id = sender || null;
  event.sender_profile_name = contacts[sender] || null;
  event.message_id = message.id ? String(message.id) : null;
  event.message_timestamp = message.timestamp
    ? String(message.timestamp)
    : null;
  if (msgType === 'text') {
    const text =
      message.text && typeof message.text === 'object'
        ? (message.text as Record<string, unknown>)
        : {};
    event.message_text = text.body ? String(text.body) : null;
  } else if (
    ['image', 'document', 'audio', 'video', 'sticker'].includes(msgType)
  ) {
    const block = message[msgType];
    const mediaId =
      block && typeof block === 'object'
        ? (block as Record<string, unknown>).id
        : null;
    if (mediaId) event.media_ids = [String(mediaId)];
  } else if (msgType === 'interactive' || msgType === 'button') {
    const interactive =
      message.interactive && typeof message.interactive === 'object'
        ? (message.interactive as Record<string, unknown>)
        : null;
    const button =
      message.button && typeof message.button === 'object'
        ? (message.button as Record<string, unknown>)
        : null;
    if (interactive) {
      event.interactive_response = { type: interactive.type };
      if (interactive.button_reply)
        event.interactive_response.button_reply = interactive.button_reply;
      if (interactive.list_reply)
        event.interactive_response.list_reply = interactive.list_reply;
      const reply = event.interactive_response;
      const buttonReply = reply.button_reply as
        Record<string, unknown> | undefined;
      const listReply = reply.list_reply as Record<string, unknown> | undefined;
      event.message_text = buttonReply?.title
        ? String(buttonReply.title)
        : listReply?.title
          ? String(listReply.title)
          : null;
    } else if (button) {
      event.interactive_response = { type: 'button', button };
      event.message_text = button.text
        ? String(button.text)
        : button.payload
          ? String(button.payload)
          : null;
    }
  } else if (msgType === 'location') {
    const location =
      message.location && typeof message.location === 'object'
        ? (message.location as Record<string, unknown>)
        : {};
    event.message_text = `lat=${location.latitude}, lng=${location.longitude}, name=${location.name}, address=${location.address}`;
  }
  if (event.event_type === 'unknown' && !event.message_text)
    event.message_text = JSON.stringify(message);
  return event;
}

function parseStatus(
  status: Record<string, unknown>,
  wabaId: string | null,
  metadata: Record<string, unknown>,
  changeField: string | null,
  rawChange: Record<string, unknown>,
): WhatsAppEvent {
  const statusValue = String(status.status || 'unknown');
  const event = baseEvent(
    'status',
    KNOWN_STATUS_VALUES.has(statusValue) ? statusValue : 'unknown',
    wabaId,
    metadata,
    changeField,
    rawChange,
  );
  event.message_id = status.id ? String(status.id) : null;
  event.message_timestamp = status.timestamp ? String(status.timestamp) : null;
  event.status = statusValue;
  event.sender_wa_id = status.recipient_id ? String(status.recipient_id) : null;
  const errors = Array.isArray(status.errors) ? status.errors : [];
  event.error_codes = errors
    .filter((item) => item && typeof item === 'object')
    .map((item) => {
      const err = item as Record<string, unknown>;
      return {
        code: err.code,
        title: err.title,
        message: err.message,
        details: err.error_data,
      };
    });
  return event;
}

function parseChange(
  change: Record<string, unknown>,
  wabaId: string | null,
): WhatsAppEvent[] {
  const value =
    change.value &&
    typeof change.value === 'object' &&
    !Array.isArray(change.value)
      ? (change.value as Record<string, unknown>)
      : null;
  if (!value) return [];
  const metadata =
    value.metadata && typeof value.metadata === 'object'
      ? (value.metadata as Record<string, unknown>)
      : {};
  const contacts = contactMap(value.contacts);
  const field = change.field ? String(change.field) : null;
  const events: WhatsAppEvent[] = [];
  for (const message of Array.isArray(value.messages) ? value.messages : []) {
    if (message && typeof message === 'object')
      events.push(
        parseMessage(
          message as Record<string, unknown>,
          wabaId,
          metadata,
          contacts,
          field,
          change,
        ),
      );
  }
  for (const status of Array.isArray(value.statuses) ? value.statuses : []) {
    if (status && typeof status === 'object')
      events.push(
        parseStatus(
          status as Record<string, unknown>,
          wabaId,
          metadata,
          field,
          change,
        ),
      );
  }
  const template = value.message_template_status_update;
  if (template && typeof template === 'object') {
    const event = baseEvent(
      'template',
      'message_template_status_update',
      wabaId,
      metadata,
      field,
      change,
    );
    const row = template as Record<string, unknown>;
    event.template_status = row;
    event.message_id = row.message_template_id
      ? String(row.message_template_id)
      : row.id
        ? String(row.id)
        : null;
    event.status = row.event
      ? String(row.event)
      : row.status
        ? String(row.status)
        : null;
    events.push(event);
  }
  for (const err of Array.isArray(value.errors) ? value.errors : []) {
    if (!err || typeof err !== 'object') continue;
    const event = baseEvent(
      'error',
      'webhook_error',
      wabaId,
      metadata,
      field,
      change,
    );
    const row = err as Record<string, unknown>;
    event.error_codes = [
      {
        code: row.code,
        title: row.title,
        message: row.message,
        details: row.error_data,
      },
    ];
    events.push(event);
  }
  if (!events.length && field)
    events.push(baseEvent('unknown', field, wabaId, metadata, field, change));
  return events;
}

export function parseWebhookPayload(
  payload: Record<string, unknown>,
): WhatsAppEvent[] {
  const events: WhatsAppEvent[] = [];
  for (const entry of Array.isArray(payload.entry) ? payload.entry : []) {
    if (!entry || typeof entry !== 'object') continue;
    const row = entry as Record<string, unknown>;
    const wabaId = row.id != null ? String(row.id) : null;
    for (const change of Array.isArray(row.changes) ? row.changes : []) {
      if (change && typeof change === 'object')
        events.push(...parseChange(change as Record<string, unknown>, wabaId));
    }
  }
  if (!events.length) {
    events.push(
      baseEvent(
        'unknown',
        String(payload.object || 'unknown'),
        null,
        {},
        null,
        { payload },
      ),
    );
  }
  return events;
}
