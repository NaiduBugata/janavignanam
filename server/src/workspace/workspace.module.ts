import { Module } from '@nestjs/common';
import { NewsModule } from '../news/news.module';
import {
  ProgressController,
  WorkspaceController,
} from './workspace.controller';
import { WorkspaceService } from './workspace.service';
import { GrokScannerService } from './grok-scanner.service';

@Module({
  imports: [NewsModule],
  controllers: [WorkspaceController, ProgressController],
  providers: [WorkspaceService, GrokScannerService],
  exports: [WorkspaceService, GrokScannerService],
})
export class WorkspaceModule {}
