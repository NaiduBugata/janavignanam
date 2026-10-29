import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { ChatbotService } from '../chatbot/chatbot.service';
import { WhatsAppController } from './whatsapp.controller';

@Injectable()
export class WhatsAppChatbotBinder implements OnModuleInit {
  private readonly logger = new Logger(WhatsAppChatbotBinder.name);

  constructor(private readonly moduleRef: ModuleRef) {}

  onModuleInit(): void {
    const controller = this.moduleRef.get(WhatsAppController, {
      strict: false,
    });
    const chatbot = this.moduleRef.get(ChatbotService, { strict: false });
    controller.useChatbot(chatbot);
    this.logger.log('WhatsApp chatbot attached.');
  }
}
