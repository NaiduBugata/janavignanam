import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { AdminOnly } from '../common/decorators/admin.decorator';
import {
  VisitsService,
  maxUploadBytes,
  type UploadedVisitFile,
} from './visits.service';
import { excelTemplate, wordTemplate } from './visits-template';

const TEMPLATES: Record<
  string,
  { mime: string; build: () => Promise<Buffer> }
> = {
  xlsx: {
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    build: excelTemplate,
  },
  docx: {
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    build: wordTemplate,
  },
};

export class CreateVisitDto {
  @IsString()
  @MaxLength(200)
  title: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  place?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  visitDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  visitTime?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  detail?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  leadPhone?: string;
}

@Controller('api')
export class VisitsController {
  constructor(private readonly visits: VisitsService) {}

  @Get('visits')
  async list() {
    return { visits: await this.visits.list() };
  }

  @Get('admin/visits')
  @AdminOnly()
  async adminList() {
    return { visits: await this.visits.listAdmin() };
  }

  /** PDFs open in the browser; Word and Excel download. `?download=1` always downloads. */
  @Get('visits/files/:id')
  async file(
    @Param('id') id: string,
    @Query('download') download: string | undefined,
    @Res() res: Response,
  ) {
    const file = await this.visits.file(id);
    const inline = file.mime === 'application/pdf' && download !== '1';
    const ascii = file.name
      .replace(/[^\x20-\x7e]/g, '_')
      .replace(/["\\]/g, '_');
    res.setHeader('Content-Type', file.mime);
    res.setHeader('Content-Length', String(file.data.length));
    res.setHeader(
      'Content-Disposition',
      `${inline ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(file.name)}`,
    );
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.end(file.data);
  }

  /** Blank Excel or Word file with the exact columns the import reads. */
  @Get('visits/template/:format')
  async template(@Param('format') format: string, @Res() res: Response) {
    const kind = TEMPLATES[format];
    if (!kind)
      throw new NotFoundException('Template format must be xlsx or docx');
    const data = await kind.build();
    res.setHeader('Content-Type', kind.mime);
    res.setHeader('Content-Length', String(data.length));
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="visits-template.${format}"`,
    );
    res.end(data);
  }

  @Post('admin/visits/import')
  @AdminOnly()
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: maxUploadBytes(), files: 1 },
    }),
  )
  async importFile(@UploadedFile() file: UploadedVisitFile | undefined) {
    return await this.visits.importFile(file);
  }

  @Post('admin/visits')
  @AdminOnly()
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: maxUploadBytes(), files: 1 },
    }),
  )
  async create(
    @Body() body: CreateVisitDto,
    @UploadedFile() file: UploadedVisitFile | undefined,
  ) {
    return { visit: await this.visits.create(body, file) };
  }

  @Delete('admin/visits/:id')
  @AdminOnly()
  @HttpCode(HttpStatus.OK)
  async remove(@Param('id') id: string) {
    await this.visits.remove(id);
    return { status: 'deleted' };
  }
}
