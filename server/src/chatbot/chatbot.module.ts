import { Module } from '@nestjs/common';
import { VisitsModule } from '../visits/visits.module';
import { WorkspaceModule } from '../workspace/workspace.module';
import { ChatbotService } from './chatbot.service';
import { GrievanceProgressService } from '../whatsapp/grievance-progress.service';

@Module({
  imports: [VisitsModule, WorkspaceModule],
  providers: [ChatbotService, GrievanceProgressService],
  exports: [ChatbotService, GrievanceProgressService],
})
export class ChatbotModule {}
