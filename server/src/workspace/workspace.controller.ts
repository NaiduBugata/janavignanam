import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Logger,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UnauthorizedException,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import {
  CreateRecordDto,
  LoginDto,
  RegisterDto,
  UpdateProgressDto,
  WORKSPACE_SECTIONS,
  type WorkspaceSection,
} from './workspace.dto';
import { queryContacts } from './contacts-directory';
import { WorkspaceService } from './workspace.service';
import { GrokScannerService } from './grok-scanner.service';

@Controller('api/workspace')
export class WorkspaceController {
  private readonly logger = new Logger(WorkspaceController.name);

  constructor(
    private readonly workspace: WorkspaceService,
    private readonly grokScanner: GrokScannerService,
  ) {}

  @Post('register')
  register(@Body() body: RegisterDto) {
    return this.workspace.register(body.email, body.password, body.name);
  }

  @Post('login')
  login(@Body() body: LoginDto) {
    return this.workspace.login(body.email, body.password);
  }

  @Get('me')
  me(@Headers('authorization') authorization?: string) {
    return this.workspace.me(bearer(authorization));
  }

  @Get('summary')
  summary(@Headers('authorization') authorization?: string) {
    this.workspace.verify(bearer(authorization));
    return this.workspace.summary();
  }

  @Get('contacts')
  contacts(
    @Query('q') q = '',
    @Query('division') division = '',
    @Query('assembly') assembly = '',
    @Query('mandal') mandal = '',
    @Query('role') role = '',
    @Query('page') page = '1',
    @Headers('authorization') authorization?: string,
  ) {
    this.workspace.verify(bearer(authorization));
    return queryContacts({
      q,
      division,
      assembly,
      mandal,
      role,
      page: Number(page) || 1,
    });
  }

  @Get('records')
  records(
    @Query('section') section: string,
    @Headers('authorization') authorization?: string,
  ) {
    this.workspace.verify(bearer(authorization));
    if (!WORKSPACE_SECTIONS.includes(section as WorkspaceSection)) {
      throw new UnauthorizedException('Unknown section');
    }
    return this.workspace.list(section as WorkspaceSection);
  }

  @Get('reports/export')
  async export(
    @Query('section') section: string,
    @Query('format') format: string,
    @Headers('authorization') authorization: string | undefined,
    @Res() res: Response,
  ) {
    this.workspace.verify(bearer(authorization));
    if (section !== 'grievances' && section !== 'projects')
      throw new UnauthorizedException('Unknown section');
    if (format !== 'pdf' && format !== 'xlsx')
      throw new UnauthorizedException('Use pdf or xlsx');
    const file = await this.workspace.reportBundle(section, format);
    sendFile(res, file.name, file.type, file.bytes);
  }

  @Get('records/:id/pdf')
  async pdf(
    @Param('id') id: string,
    @Headers('authorization') authorization: string | undefined,
    @Res() res: Response,
  ) {
    this.workspace.verify(bearer(authorization));
    const file = await this.workspace.reportFile(id);
    sendFile(res, file.name, 'application/pdf', file.bytes);
  }

  @Get('records/:id')
  one(
    @Param('id') id: string,
    @Headers('authorization') authorization?: string,
  ) {
    this.workspace.verify(bearer(authorization));
    return this.workspace.get(id);
  }

  @Post('records')
  async create(
    @Body() body: CreateRecordDto,
    @Headers('authorization') authorization?: string,
  ) {
    const user = await this.workspace.me(bearer(authorization));
    return this.workspace.create({
      section: body.section,
      title: body.title,
      detail: body.detail,
      status: body.status,
      createdBy: user.email,
      srNumber: body.srNumber,
      fullName: body.fullName,
      contactNumber: body.contactNumber,
      address: body.address,
      email: body.email,
      village: body.village,
      mandal: body.mandal,
      division: body.division,
      assemblyConstituency: body.assemblyConstituency,
      dateOfVisit: body.dateOfVisit,
      referenceName: body.referenceName,
      referenceNumber: body.referenceNumber,
      categories: body.categories,
      others: body.others,
      actionTaken: body.actionTaken,
      actionToBeTaken: body.actionToBeTaken,
      assignedOfficer: body.assignedOfficer,
      resolutionStatus: body.resolutionStatus,
      deadline: body.deadline,
      place: body.place,
      visitDate: body.visitDate,
      visitTime: body.visitTime,
      leadPhone: body.leadPhone,
    });
  }

  @Post('records/:id/approve')
  async approve(
    @Param('id') id: string,
    @Headers('authorization') authorization?: string,
  ) {
    await this.workspace.me(bearer(authorization));
    return this.workspace.approve(id);
  }

  @Patch('records/:id')
  async update(
    @Param('id') id: string,
    @Body() body: CreateRecordDto,
    @Headers('authorization') authorization?: string,
  ) {
    await this.workspace.me(bearer(authorization));
    return this.workspace.update(id, body);
  }

  @Delete('records/:id')
  async remove(
    @Param('id') id: string,
    @Headers('authorization') authorization?: string,
  ) {
    await this.workspace.me(bearer(authorization));
    return this.workspace.remove(id);
  }

  @Post('records/:id/documents')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 10 * 1024 * 1024, files: 1 },
    }),
  )
  async uploadDocument(
    @Param('id') id: string,
    @UploadedFile()
    file?: {
      buffer?: Buffer;
      originalname?: string;
      mimetype?: string;
      size?: number;
    },
    @Headers('authorization') authorization?: string,
  ) {
    await this.workspace.me(bearer(authorization));
    if (!file || !file.buffer) {
      throw new BadRequestException('Please select a document to upload.');
    }
    const validMimes = [
      'application/pdf',
      'image/jpeg',
      'image/png',
      'image/jpg',
    ];
    const isMimeValid =
      file.mimetype && validMimes.includes(file.mimetype.toLowerCase());
    const isExtValid = /\.(pdf|jpe?g|png)$/i.test(file.originalname || '');
    if (!isMimeValid && !isExtValid) {
      throw new BadRequestException(
        'Unsupported file format. Please upload a PDF, JPG, JPEG, or PNG document.',
      );
    }
    try {
      return await this.workspace.addDocumentToGrievance(id, {
        buffer: file.buffer,
        originalname: file.originalname || 'document',
        mimetype: file.mimetype || 'application/octet-stream',
        size: file.size || file.buffer.length,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Document upload error for grievance ${id}: ${msg}`);
      throw new BadRequestException(`Document upload failed: ${msg}`);
    }
  }

  @Get('records/:id/documents/:docId/file')
  async documentFile(
    @Param('id') id: string,
    @Param('docId') docId: string,
    @Query('download') download: string | undefined,
    @Query('token') queryToken: string | undefined,
    @Headers('authorization') authorization: string | undefined,
    @Res() res: Response,
  ) {
    const token = authorization ? bearer(authorization) : queryToken;
    if (!token) throw new UnauthorizedException('Sign in required');
    await this.workspace.me(token);

    const file = await this.workspace.getDocumentFile(id, docId);
    const inline =
      (file.mimeType === 'application/pdf' ||
        file.mimeType.startsWith('image/')) &&
      download !== '1';
    const ascii = file.filename
      .replace(/[^\x20-\x7e]/g, '_')
      .replace(/["\\]/g, '_');

    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Content-Length', String(file.buffer.length));
    res.setHeader(
      'Content-Disposition',
      `${inline ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
    );
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.end(file.buffer);
  }

  @Delete('records/:id/documents/:docId')
  async removeDocument(
    @Param('id') id: string,
    @Param('docId') docId: string,
    @Headers('authorization') authorization?: string,
  ) {
    await this.workspace.me(bearer(authorization));
    return this.workspace.removeDocumentFromGrievance(id, docId);
  }

  @Post('records/:id/documents/:docId/apply')
  async applyExtractedData(
    @Param('id') id: string,
    @Param('docId') docId: string,
    @Headers('authorization') authorization?: string,
  ) {
    await this.workspace.me(bearer(authorization));
    return this.workspace.applyExtractedDataToGrievance(id, docId);
  }

  @Post('documents/scan-preview')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 10 * 1024 * 1024, files: 1 },
    }),
  )
  async scanPreview(
    @UploadedFile()
    file?: {
      buffer?: Buffer;
      originalname?: string;
      mimetype?: string;
      size?: number;
    },
    @Headers('authorization') authorization?: string,
  ) {
    await this.workspace.me(bearer(authorization));
    if (!file || !file.buffer) {
      throw new BadRequestException('Please select a document to scan.');
    }
    const validMimes = [
      'application/pdf',
      'image/jpeg',
      'image/png',
      'image/jpg',
    ];
    const isMimeValid =
      file.mimetype && validMimes.includes(file.mimetype.toLowerCase());
    const isExtValid = /\.(pdf|jpe?g|png)$/i.test(file.originalname || '');
    if (!isMimeValid && !isExtValid) {
      throw new BadRequestException(
        'Unsupported file format. Please upload a PDF, JPG, JPEG, or PNG document.',
      );
    }
    try {
      const result = await this.grokScanner.scanDocument({
        buffer: file.buffer,
        mimeType: file.mimetype || 'application/octet-stream',
        filename: file.originalname || 'document',
      });
      return {
        filename: file.originalname,
        mimeType: file.mimetype,
        sizeBytes: file.size || file.buffer.length,
        extractedText: result.extractedText,
        structuredData: result.structuredData,
        modelUsed: result.modelUsed,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Scan preview fallback engaged: ${msg}`);
      const fallbackData = this.grokScanner.heuristicExtraction('', file.originalname || 'document');
      return {
        filename: file.originalname,
        mimeType: file.mimetype,
        sizeBytes: file.size || file.buffer.length,
        extractedText: `[Document: ${file.originalname}]\\nScanned. Notice: ${msg}`,
        structuredData: fallbackData,
        modelUsed: 'local-fallback',
      };
    }
  }

}

@Controller('api/progress')
export class ProgressController {
  constructor(private readonly workspace: WorkspaceService) {}

  @Get(':token')
  one(@Param('token') token: string) {
    return this.workspace.progressByToken(token);
  }

  @Patch(':token')
  async save(@Param('token') token: string, @Body() body: UpdateProgressDto) {
    const stages = body.stages?.map((stage) => ({
      name: stage.name,
      status: stage.status,
      note: stage.note || '',
    }));
    await this.workspace.saveProgress(token, {
      stages,
      status: body.status,
      remarks: body.remarks,
      department: body.department,
    });
    return this.workspace.progressByToken(token);
  }
}

function sendFile(res: Response, name: string, type: string, bytes: Buffer) {
  res.setHeader('Content-Type', type);
  res.setHeader('Content-Length', String(bytes.length));
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${name.replace(/"/g, '')}"`,
  );
  res.end(bytes);
}

function bearer(authorization?: string): string {
  const match = /^Bearer\s+(.+)$/i.exec(authorization || '');
  if (!match) throw new UnauthorizedException('Sign in required');
  return match[1].trim();
}
