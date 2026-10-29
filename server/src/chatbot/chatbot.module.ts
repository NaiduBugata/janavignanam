import { Module } from '@nestjs/common';
import { VisitsModule } from '../visits/visits.module';
import { WorkspaceModule } from '../workspace/workspace.module';
import { ChatbotService } from './chatbot.service';

@Module({
  imports: [VisitsModule, WorkspaceModule],
  providers: [ChatbotService],
  exports: [ChatbotService],
})
export class ChatbotModule {}
