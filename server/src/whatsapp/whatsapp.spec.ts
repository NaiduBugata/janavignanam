import { WhatsAppController } from './whatsapp.controller';
import type { WhatsAppWebhookRepository } from './whatsapp.repository';
import { processWebhookPost, verifyWebhook } from './whatsapp.webhook';
import { WhatsAppLifecycleService } from './whatsapp.lifecycle';
import {
  notifyCriticalWhatsApp,
  notifyCustomWhatsApp,
  notifyFailureWhatsApp,
  notifyPendingWhatsApp,
  notifyPipelineWhatsApp,
} from './whatsapp.notify';
import { clearStaffDirectory, setStaffDirectory } from './whatsapp.audience';
import { setMutedSenders } from './whatsapp.muted';
import {
  deliverWhatsApp,
  sendReplyButtons,
  sendTemplateMessage,
  setWhatsAppStatusRecorder,
} from './whatsapp.send';

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

function mockRes() {
  return {
    statusCode: 200,
    contentType: '',
    body: '',
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    type(value: string) {
      this.contentType = value;
      return this;
    },
    send(value: string) {
      this.body = value;
      return this;
    },
  };
}

const textPayload = {
  object: 'whatsapp_business_account',
  entry: [
    {
      id: '123456789',
      changes: [
        {
          field: 'messages',
          value: {
            metadata: {
              display_phone_number: '15551234567',
              phone_number_id: '987654321',
            },
            contacts: [
              { profile: { name: 'Test User' }, wa_id: '919876543210' },
            ],
            messages: [
              {
                from: '919876543210',
                id: 'wamid.test123',
                timestamp: '1710000000',
                type: 'text',
                text: { body: 'Hello MediaSphere' },
              },
            ],
          },
        },
      ],
    },
  ],
};

describe('WhatsApp webhook', () => {
  const original = { ...process.env };

  afterEach(() => {
    process.env = { ...original };
  });

  it('returns the challenge as plain text and rejects a bad token', () => {
    process.env.WHATSAPP_WEBHOOK_ENABLED = 'true';
    process.env.WHATSAPP_VERIFY_TOKEN = 'test-verify-token';
    expect(
      verifyWebhook({
        mode: 'subscribe',
        token: 'test-verify-token',
        challenge: '1234567890',
      }),
    ).toEqual({
      body: '1234567890',
      status: 200,
    });
    expect(
      verifyWebhook({
        mode: 'subscribe',
        token: 'wrong',
        challenge: '1234567890',
      }).status,
    ).toBe(403);
    process.env.WHATSAPP_WEBHOOK_ENABLED = 'false';
    expect(
      verifyWebhook({
        mode: 'subscribe',
        token: 'test-verify-token',
        challenge: '1',
      }).status,
    ).toBe(503);
  });

  it('accepts a text message and a status without calling Mongo when save is injected', async () => {
    const saved: Array<Record<string, unknown>> = [];
    const save = async (event: Record<string, unknown>) => {
      saved.push(event);
    };
    const text = await processWebhookPost(textPayload, { save: save as never });
    expect(text).toEqual({ body: 'EVENT_RECEIVED', status: 200 });
    expect(saved[0].message_text).toBe('Hello MediaSphere');
    expect(saved[0].sender_profile_name).toBe('Test User');

    const status = await processWebhookPost(
      {
        object: 'whatsapp_business_account',
        entry: [
          {
            id: '123456789',
            changes: [
              {
                field: 'messages',
                value: {
                  statuses: [
                    {
                      id: 'wamid.test123',
                      status: 'delivered',
                      timestamp: '1710000001',
                      recipient_id: '919876543210',
                    },
                  ],
                },
              },
            ],
          },
        ],
      },
      { save: save as never },
    );
    expect(status.status).toBe(200);
    expect(saved[1].event_category).toBe('status');
    expect(await processWebhookPost(null, { save: save as never })).toEqual({
      body: 'Invalid JSON payload',
      status: 400,
    });
  });

  it('answers the controller as text/plain', async () => {
    process.env.WHATSAPP_WEBHOOK_ENABLED = 'true';
    process.env.WHATSAPP_VERIFY_TOKEN = 'test-verify-token';
    const saved: unknown[] = [];
    const controller = new WhatsAppController({
      saveEvent: async (event: unknown) => {
        saved.push(event);
      },
    } as unknown as WhatsAppWebhookRepository);
    const res = mockRes();
    controller.verify(
      {
        query: {
          'hub.mode': 'subscribe',
          'hub.verify_token': 'test-verify-token',
          'hub.challenge': '99',
        },
      } as never,
      res as never,
    );
    expect(res.statusCode).toBe(200);
    expect(res.contentType).toBe('text/plain');
    expect(res.body).toBe('99');

    const post = mockRes();
    await controller.receive(
      { body: textPayload, header: () => undefined, ip: '127.0.0.1' } as never,
      post as never,
    );
    expect(post.statusCode).toBe(200);
    expect(post.body).toBe('EVENT_RECEIVED');
    expect(saved).toHaveLength(1);
  });

  it('neither stores nor passes to the chatbot a message from a one-way birthday number', async () => {
    process.env.WHATSAPP_WEBHOOK_ENABLED = 'true';
    const saved: unknown[] = [];
    const seen: unknown[] = [];
    const controller = new WhatsAppController({
      saveEvent: async (event: unknown) => {
        saved.push(event);
      },
    } as unknown as WhatsAppWebhookRepository);
    controller.useChatbot({
      consider: (payload) => {
        seen.push(payload);
      },
    });
    const sender = textPayload.entry[0].changes[0].value.messages[0].from;
    setMutedSenders([sender]);
    try {
      const post = mockRes();
      await controller.receive(
        {
          body: textPayload,
          header: () => undefined,
          ip: '127.0.0.1',
        } as never,
        post as never,
      );
      expect(post.statusCode).toBe(200);
      expect(post.body).toBe('EVENT_RECEIVED');
      expect(saved).toHaveLength(0);
      expect(seen).toHaveLength(0);
    } finally {
      setMutedSenders([]);
    }
  });
});

describe('WhatsApp sending', () => {
  const original = { ...process.env };

  afterEach(() => {
    process.env = { ...original };
    setWhatsAppStatusRecorder(null);
  });

  it('does not call Graph when WhatsApp is disabled', async () => {
    process.env.WHATSAPP_ENABLED = 'false';
    const fetchImpl = (async () => {
      throw new Error('network');
    }) as typeof fetch;
    const result = await deliverWhatsApp({ text: 'hello' }, fetchImpl);
    expect(result.skipped).toBe(true);
    expect(result.skip_reason).toBe('whatsapp_disabled_or_misconfigured');
  });

  it('sends no automatic alert on WhatsApp unless WHATSAPP_ALERTS_ENABLED is set, while menu replies still go out', async () => {
    process.env.WHATSAPP_ENABLED = 'true';
    process.env.WHATSAPP_ACCESS_TOKEN = 'test-token';
    process.env.WHATSAPP_PHONE_NUMBER_ID = '987654321';
    process.env.WHATSAPP_RECIPIENTS = '919876543210';
    delete process.env.WHATSAPP_ALERTS_ENABLED;
    const calls: Array<Record<string, unknown>> = [];
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      calls.push(JSON.parse(String(init?.body)));
      return jsonResponse({ messages: [{ id: 'wamid.menu' }] });
    }) as typeof fetch;

    const alert = await deliverWhatsApp(
      { text: 'PIPELINE FAILURE' },
      fetchImpl,
    );
    expect(alert).toMatchObject({
      skipped: true,
      skip_reason: 'whatsapp_alerts_off_email_only',
    });
    const failure = await notifyFailureWhatsApp(
      'combined_pipeline',
      'down',
      'N/A',
      fetchImpl,
    );
    expect(failure.skipped).toBe(false);
    expect(calls).toHaveLength(1);
    const pending = await notifyPendingWhatsApp({
      fetchImpl,
      findPending: async () => {
        throw new Error('should not look up pending articles');
      },
      markSent: async () => {
        throw new Error('should not mark');
      },
    });
    expect(pending).toMatchObject({
      skipped: true,
      skip_reason: 'whatsapp_alerts_off_email_only',
      sent: 0,
    });
    expect(calls).toHaveLength(1);

    await sendReplyButtons(
      '919876543210',
      'Tap a section',
      [{ id: 'news', title: 'News' }],
      fetchImpl,
    );
    expect(calls.map((call) => call.type)).toEqual(['template', 'interactive']);
  });

  it('posts a template and falls back to text when Meta rejects the template', async () => {
    process.env.WHATSAPP_ENABLED = 'true';
    process.env.WHATSAPP_ALERTS_ENABLED = 'true';
    process.env.WHATSAPP_ACCESS_TOKEN = 'test-token';
    process.env.WHATSAPP_PHONE_NUMBER_ID = '987654321';
    process.env.WHATSAPP_RECIPIENTS = '919876543210';
    process.env.WHATSAPP_USE_TEMPLATES = 'true';
    process.env.NOTIFICATION_MAX_RETRIES = '1';
    process.env.NOTIFICATION_RETRY_BASE_SECONDS = '0';
    const calls: Array<Record<string, unknown>> = [];
    let n = 0;
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      n += 1;
      calls.push(JSON.parse(String(init?.body)));
      if (n === 1) {
        return jsonResponse(
          { error: { message: 'Template name does not exist', code: 132001 } },
          400,
        );
      }
      return jsonResponse({ messages: [{ id: 'wamid.sent' }] });
    }) as typeof fetch;

    const result = await deliverWhatsApp(
      {
        text: 'Road update',
        variables: ['Narasaraopet', 'Road update', 'INFO', 'Lokal', 'now'],
      },
      fetchImpl,
    );
    expect(result.success).toBe(true);
    expect(result.messageId).toBe('wamid.sent');
    expect(calls[0].type).toBe('template');
    expect(calls[1].type).toBe('text');
    expect((calls[1].text as { body: string }).body).toBe('Road update');
  });

  it('sends reply buttons and never a link button', async () => {
    process.env.WHATSAPP_ACCESS_TOKEN = 'test-token';
    process.env.WHATSAPP_PHONE_NUMBER_ID = '987654321';
    const calls: Array<Record<string, unknown>> = [];
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      calls.push(JSON.parse(String(init?.body)));
      return jsonResponse({ messages: [{ id: 'wamid.menu' }] });
    }) as typeof fetch;
    await sendReplyButtons(
      '919876543210',
      'Tap a section',
      [
        { id: 'grievances', title: 'Grievances' },
        { id: 'projects', title: 'Projects & reports' },
        { id: 'news', title: 'News' },
      ],
      fetchImpl,
    );
    const interactive = calls[0].interactive as {
      type: string;
      action: { buttons: Array<{ type: string; reply: { id: string } }> };
    };
    expect(calls[0].type).toBe('interactive');
    expect(interactive.type).toBe('button');
    expect(interactive.action.buttons.map((button) => button.type)).toEqual([
      'reply',
      'reply',
      'reply',
    ]);
    expect(interactive.action.buttons.map((button) => button.reply.id)).toEqual(
      ['grievances', 'projects', 'news'],
    );
    expect(JSON.stringify(calls[0])).not.toContain('url');
  });

  it('rejects a recipient that is not a phone number', async () => {
    process.env.WHATSAPP_ACCESS_TOKEN = 'test-token';
    process.env.WHATSAPP_PHONE_NUMBER_ID = '987654321';
    await expect(
      sendTemplateMessage('not-a-phone', 'mediasphere_critical_issue', {
        fetchImpl: async () => jsonResponse({}),
      }),
    ).rejects.toThrow('Invalid WhatsApp recipient');
  });
});

function readyEnv(): void {
  process.env.WHATSAPP_ENABLED = 'true';
  process.env.WHATSAPP_ALERTS_ENABLED = 'true';
  process.env.WHATSAPP_ACCESS_TOKEN = 'test-token';
  process.env.WHATSAPP_PHONE_NUMBER_ID = '987654321';
  process.env.WHATSAPP_RECIPIENTS = '919876543210';
  process.env.WHATSAPP_USE_TEMPLATES = 'true';
  process.env.NOTIFICATION_MAX_RETRIES = '1';
  process.env.NOTIFICATION_RETRY_BASE_SECONDS = '0';
}

describe('WhatsApp notices', () => {
  const original = { ...process.env };

  afterEach(() => {
    process.env = { ...original };
    setWhatsAppStatusRecorder(null);
  });

  it('does not look up pending articles when WhatsApp is off', async () => {
    process.env.WHATSAPP_ENABLED = 'false';
    let looked = false;
    const result = await notifyPendingWhatsApp({
      findPending: async () => {
        looked = true;
        return [{ post_id: '1' }];
      },
      markSent: async () => {
        throw new Error('should not mark');
      },
    });
    expect(looked).toBe(false);
    expect(result.skip_reason).toBe('whatsapp_disabled_or_misconfigured');
    expect(result.sent).toBe(0);
  });

  it('sends pending articles and marks critical ones sent', async () => {
    readyEnv();
    const marked: Array<{
      postId: string;
      messageId: string | null;
      critical: boolean;
    }> = [];
    const bodies: Array<Record<string, unknown>> = [];
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return jsonResponse({ messages: [{ id: 'wamid.pending' }] });
    }) as typeof fetch;
    const result = await notifyPendingWhatsApp({
      fetchImpl,
      findPending: async () => [
        {
          post_id: 'sakshi_1',
          title: 'Road',
          problem: 'Potholes',
          sentiment: 'problem',
          severity: 'high',
          source: 'sakshi',
        },
      ],
      markSent: async (postId, messageId, critical) => {
        marked.push({ postId, messageId, critical });
      },
    });
    expect(result.sent).toBe(1);
    expect(result.failed).toBe(0);
    expect(marked).toEqual([
      { postId: 'sakshi_1', messageId: 'wamid.pending', critical: true },
    ]);
    expect(String((bodies[0].template as { name: string }).name)).toBe(
      'mediasphere_critical_issue',
    );
    expect(
      (
        bodies[0].template as {
          components: Array<{ parameters: Array<{ text: string }> }>;
        }
      ).components[0].parameters,
    ).toHaveLength(5);
  });

  it('skips a critical notice that is not high severity', async () => {
    const result = await notifyCriticalWhatsApp({
      sentiment: 'neutral',
      severity: 'low',
    });
    expect(result).toEqual({ status: 'skipped', reason: 'not_critical' });
  });

  it('uses the pipeline template name when single-template mode is off', async () => {
    readyEnv();
    process.env.WHATSAPP_FORCE_SINGLE_TEMPLATE = 'false';
    const bodies: Array<Record<string, unknown>> = [];
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return jsonResponse({ messages: [{ id: 'wamid.pipe' }] });
    }) as typeof fetch;
    const result = await notifyPipelineWhatsApp(
      { inserted: 2, articles_fetched: 4, duration_seconds: 3, status: 'ok' },
      fetchImpl,
    );
    expect(result.success).toBe(true);
    expect((bodies[0].template as { name: string }).name).toBe(
      'mediasphere_pipeline_status',
    );
  });

  it('sends a failure notice that names the module', async () => {
    readyEnv();
    const bodies: Array<Record<string, unknown>> = [];
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return jsonResponse({ messages: [{ id: 'wamid.fail' }] });
    }) as typeof fetch;
    const result = await notifyFailureWhatsApp(
      'combined_pipeline',
      'collector down',
      'N/A',
      fetchImpl,
    );
    expect(result.notification_type).toBe('failure');
    const text =
      bodies[0].type === 'template'
        ? (
            bodies[0].template as {
              components: Array<{ parameters: Array<{ text: string }> }>;
            }
          ).components[0].parameters
            .map((item) => item.text)
            .join(' ')
        : '';
    expect(
      text.includes('combined_pipeline') ||
        text.includes('PIPELINE FAILURE') ||
        text.includes('collector down'),
    ).toBe(true);
  });

  it('sends a custom notice and records status only through the injected recorder', async () => {
    readyEnv();
    const recorded: string[] = [];
    setWhatsAppStatusRecorder(async (update) => {
      recorded.push(update.status);
    });
    const fetchImpl = (async () =>
      jsonResponse({ messages: [{ id: 'wamid.custom' }] })) as typeof fetch;
    const result = await notifyCustomWhatsApp('Manual check', fetchImpl);
    expect(result.notification_type).toBe('custom');
    expect(result.success).toBe(true);
    expect(recorded).toEqual(['ok']);
  });

  it('does not send startup or shutdown WhatsApp unless WHATSAPP_ON_API is set', () => {
    readyEnv();
    delete process.env.WHATSAPP_ON_API;
    let calls = 0;
    const originalFetch = global.fetch;
    global.fetch = async () => {
      calls += 1;
      throw new Error('graph');
    };
    const service = new WhatsAppLifecycleService({
      record: async () => undefined,
    } as never);
    service.onModuleInit();
    service.onModuleDestroy();
    global.fetch = originalFetch;
    expect(calls).toBe(0);
  });

  it('sends pipeline success and failure only to the super admin, and other alerts to admins too', async () => {
    readyEnv();
    process.env.WHATSAPP_RECIPIENTS = '919000000001,919000000002,919000000003';
    setStaffDirectory([
      { phone: '919000000001', role: 'superadmin' },
      { phone: '919000000002', role: 'admin' },
      { phone: '919000000003', role: 'user' },
    ]);
    const sent: string[] = [];
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      sent.push(String((JSON.parse(String(init?.body)) as { to?: string }).to));
      return jsonResponse({ messages: [{ id: 'wamid.role' }] });
    }) as typeof fetch;
    await notifyPipelineWhatsApp(
      { inserted: 1, articles_fetched: 1, duration_seconds: 1, status: 'ok' },
      fetchImpl,
    );
    await notifyFailureWhatsApp('combined_pipeline', 'down', 'N/A', fetchImpl);
    const pipeline = [...sent];
    await notifyCustomWhatsApp('A message', fetchImpl);
    clearStaffDirectory();
    expect(pipeline).toEqual(['919000000001', '919000000001']);
    expect(sent.slice(pipeline.length).sort()).toEqual([
      '919000000001',
      '919000000002',
    ]);
  });
});
