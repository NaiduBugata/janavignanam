import { Module } from '@nestjs/common';
import { AdminAuthService } from './auth/admin-auth.service';
import { AdminAuthController } from './auth/admin-auth.controller';
import { AdminFetchService } from './fetch/admin-fetch.service';
import { AdminController } from './admin.controller';
import { AdminUploadController } from './upload/admin-upload.controller';
import { AdminUploadService } from './upload/admin-upload.service';
import { AdminDeskController } from './desk/admin-desk.controller';
import { AdminDeskService } from './desk/admin-desk.service';
import { AdminAuthGuard } from '../common/guards/admin-auth.guard';
import { PipelineModule } from '../pipeline/pipeline.module';

@Module({
  imports: [PipelineModule],
  controllers: [
    AdminAuthController,
    AdminController,
    AdminUploadController,
    AdminDeskController,
  ],
  providers: [
    AdminAuthService,
    AdminFetchService,
    AdminAuthGuard,
    AdminUploadService,
    AdminDeskService,
  ],
  exports: [AdminAuthService],
})
export class AdminModule {}
