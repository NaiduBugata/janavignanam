import { Module } from '@nestjs/common';
import {
  ProgressController,
  WorkspaceController,
} from './workspace.controller';
import { WorkspaceService } from './workspace.service';
import { GrokScannerService } from './grok-scanner.service';

@Module({
  controllers: [WorkspaceController, ProgressController],
  providers: [WorkspaceService, GrokScannerService],
  exports: [WorkspaceService, GrokScannerService],
})
export class WorkspaceModule {}
