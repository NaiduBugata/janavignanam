import { Module } from '@nestjs/common';
import { VisitsModule } from '../visits/visits.module';
import { WorkspaceModule } from '../workspace/workspace.module';
import { ChatbotService } from './chatbot.service';
import { GrievanceProgressService } from '../whatsapp/grievance-progress.service';
import { DepartmentOperationsService } from '../whatsapp/department-operations.service';

@Module({
  imports: [VisitsModule, WorkspaceModule],
  providers: [
    ChatbotService,
    GrievanceProgressService,
    DepartmentOperationsService,
  ],
  exports: [
    ChatbotService,
    GrievanceProgressService,
    DepartmentOperationsService,
  ],
})
export class ChatbotModule {}
