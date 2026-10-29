import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { AdminOnly } from '../../common/decorators/admin.decorator';
import { UPLOAD_KINDS, UPLOAD_SPECS } from './admin-upload';
import { AdminUploadService } from './admin-upload.service';

@Controller('api/admin/upload')
@AdminOnly()
export class AdminUploadController {
  constructor(private readonly uploads: AdminUploadService) {}

  @Get('kinds')
  kinds() {
    return {
      kinds: UPLOAD_KINDS.map((id) => ({
        id,
        headers: UPLOAD_SPECS[id].headers,
        example: UPLOAD_SPECS[id].example,
      })),
    };
  }

  @Get('template/:kind')
  template(@Param('kind') kind: string, @Res() res: Response) {
    const file = this.uploads.template(kind);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${file.filename}"`,
    );
    res.send(file.body);
  }

  @Post()
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 5 * 1024 * 1024, files: 1 },
    }),
  )
  save(
    @Body('kind') kind: string,
    @UploadedFile() file?: { originalname?: string; buffer?: Buffer },
  ) {
    if (!kind) throw new BadRequestException('Choose what this file is for.');
    return this.uploads.save(kind, file);
  }
}
