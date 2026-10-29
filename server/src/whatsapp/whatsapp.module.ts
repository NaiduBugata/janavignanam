import { Module } from '@nestjs/common';
import { ChatbotModule } from '../chatbot/chatbot.module';
import { WhatsAppChatbotBinder } from './whatsapp-chatbot.binder';
import { WhatsAppController } from './whatsapp.controller';
import { WhatsAppLifecycleService } from './whatsapp.lifecycle';
import { WhatsAppWebhookRepository } from './whatsapp.repository';

@Module({
  imports: [ChatbotModule],
  controllers: [WhatsAppController],
  providers: [
    WhatsAppWebhookRepository,
    WhatsAppLifecycleService,
    WhatsAppChatbotBinder,
  ],
  exports: [WhatsAppWebhookRepository],
})
export class WhatsAppModule {}
