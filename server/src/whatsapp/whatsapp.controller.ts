import { Controller, Get, Logger, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  contactSenders,
  noteContactInbound,
  withoutMutedMessages,
} from './whatsapp.muted';
import { WhatsAppWebhookRepository } from './whatsapp.repository';
import { notifyFailedStatuses } from './whatsapp.notify';
import {
  processWebhookPost,
  verifyWebhook,
  webhookEnabled,
} from './whatsapp.webhook';

export interface ChatbotReply {
  consider(payload: unknown): void;
}

@Controller()
export class WhatsAppController {
  private readonly logger = new Logger(WhatsAppController.name);
  private chatbot: ChatbotReply | null = null;

  constructor(private readonly events: WhatsAppWebhookRepository) {}

  /** Called once after the module is ready. Keeps ChatbotService out of this constructor. */
  useChatbot(chatbot: ChatbotReply): void {
    this.chatbot = chatbot;
  }

  @Get('webhook')
  verify(@Req() req: Request, @Res() res: Response): void {
    const query = req.query as Record<string, string | undefined>;
    const result = verifyWebhook({
      mode: query['hub.mode'],
      token: query['hub.verify_token'],
      challenge: query['hub.challenge'],
    });
    res.status(result.status).type('text/plain').send(result.body);
  }

  @Post('webhook')
  async receive(@Req() req: Request, @Res() res: Response): Promise<void> {
    if (!webhookEnabled()) {
      res.status(503).type('text/plain').send('Webhook disabled');
      return;
    }
    const forwarded = req.header('x-forwarded-for');
    const clientIp = forwarded
      ? forwarded.split(',')[0].trim()
      : req.ip || null;
    await noteContactInbound(contactSenders(req.body));
    const { payload, dropped } = withoutMutedMessages(req.body);
    if (dropped)
      this.logger.log(
        `Ignored ${dropped} incoming message(s) from one-way birthday contacts.`,
      );
    const empty =
      dropped > 0 && !((payload as { entry?: unknown[] }).entry || []).length;
    if (empty) {
      res.status(200).type('text/plain').send('EVENT_RECEIVED');
      return;
    }
    const result = await processWebhookPost(payload, {
      clientIp,
      wabaId:
        process.env.WHATSAPP_WABA_ID ||
        process.env.WHATSAPP_BUSINESS_ACCOUNT_ID ||
        '',
      save: (event, raw) => this.events.saveEvent(event, clientIp, raw),
    });
    res.status(result.status).type('text/plain').send(result.body);
    if (result.status === 200) this.chatbot?.consider(payload);
  }
}
