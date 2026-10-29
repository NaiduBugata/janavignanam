import { Module } from '@nestjs/common';
import {
  ProgressController,
  WorkspaceController,
} from './workspace.controller';
import { WorkspaceService } from './workspace.service';

@Module({
  controllers: [WorkspaceController, ProgressController],
  providers: [WorkspaceService],
  exports: [WorkspaceService],
})
export class WorkspaceModule {}
