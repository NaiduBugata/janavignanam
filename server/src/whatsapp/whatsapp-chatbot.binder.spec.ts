import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ChatbotService } from '../chatbot/chatbot.service';
import { WhatsAppChatbotBinder } from './whatsapp-chatbot.binder';
import { WhatsAppController } from './whatsapp.controller';
import { WhatsAppWebhookRepository } from './whatsapp.repository';

@Module({
  controllers: [WhatsAppController],
  providers: [
    WhatsAppChatbotBinder,
    {
      provide: WhatsAppWebhookRepository,
      useValue: { saveEvent: async () => undefined },
    },
    { provide: ChatbotService, useValue: { consider: () => undefined } },
  ],
})
class ProbeModule {}

describe('WhatsApp chatbot wiring', () => {
  it('gives the controller one constructor dependency', () => {
    const params = Reflect.getMetadata(
      'design:paramtypes',
      WhatsAppController,
    ) as unknown[];
    expect(params).toHaveLength(1);
    expect(params[0]).toBe(WhatsAppWebhookRepository);
  });

  it('attaches the chatbot after the module starts', async () => {
    const seen: unknown[] = [];
    const moduleRef = await Test.createTestingModule({
      imports: [ProbeModule],
    })
      .overrideProvider(ChatbotService)
      .useValue({
        consider: (payload: unknown) => {
          seen.push(payload);
        },
      })
      .compile();
    const app = moduleRef.createNestApplication();
    await app.init();
    const controller = app.get(WhatsAppController);
    process.env.WHATSAPP_WEBHOOK_ENABLED = 'true';
    const res = {
      statusCode: 0,
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      type() {
        return this;
      },
      send() {
        return this;
      },
    };
    await controller.receive(
      {
        body: { object: 'whatsapp_business_account', entry: [] },
        header: () => undefined,
        ip: '127.0.0.1',
      } as never,
      res as never,
    );
    expect(res.statusCode).toBe(200);
    expect(seen).toHaveLength(1);
    await app.close();
  });
});
