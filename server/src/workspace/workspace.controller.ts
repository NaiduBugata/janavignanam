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
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import {
  FileFieldsInterceptor,
  FileInterceptor,
} from '@nestjs/platform-express';
import type { Response } from 'express';
import {
  CreateRecordDto,
  ISSUE_CATEGORIES,
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
      assignedOfficerPhone: body.assignedOfficerPhone,
      issueDetail: body.issueDetail,
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
    @Body()
    body?: {
      extractedText?: string;
      structuredData?: string;
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
      let preScanned: { extractedText?: string; structuredData?: any } | undefined;
      if (body?.extractedText) {
        let parsedStruct: any = undefined;
        if (body.structuredData) {
          try {
            parsedStruct =
              typeof body.structuredData === 'string'
                ? JSON.parse(body.structuredData)
                : body.structuredData;
          } catch {}
        }
        preScanned = {
          extractedText: body.extractedText,
          structuredData: parsedStruct,
        };
      }
      return await this.workspace.addDocumentToGrievance(
        id,
        {
          buffer: file.buffer,
          originalname: file.originalname || 'document',
          mimetype: file.mimetype || 'application/octet-stream',
          size: file.size || file.buffer.length,
        },
        preScanned,
      );
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

  @Post('documents/scan-batch')
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'grievanceFile', maxCount: 1 },
        { name: 'supportingFile', maxCount: 1 },
      ],
      {
        limits: { fileSize: 10 * 1024 * 1024 },
      },
    ),
  )
  async scanBatch(
    @UploadedFiles()
    files: {
      grievanceFile?: Array<{
        buffer?: Buffer;
        originalname?: string;
        mimetype?: string;
        size?: number;
      }>;
      supportingFile?: Array<{
        buffer?: Buffer;
        originalname?: string;
        mimetype?: string;
        size?: number;
      }>;
    },
    @Headers('authorization') authorization?: string,
  ) {
    await this.workspace.me(bearer(authorization));
    const gFile = files?.grievanceFile?.[0];
    const sFile = files?.supportingFile?.[0];

    if (!gFile && !sFile) {
      throw new BadRequestException(
        'Please select at least one document to scan.',
      );
    }

    const validMimes = [
      'application/pdf',
      'image/jpeg',
      'image/png',
      'image/jpg',
    ];

    const validateFile = (f: { originalname?: string; mimetype?: string }) => {
      const isMimeValid =
        f.mimetype && validMimes.includes(f.mimetype.toLowerCase());
      const isExtValid = /\.(pdf|jpe?g|png)$/i.test(f.originalname || '');
      return isMimeValid || isExtValid;
    };

    if (gFile && !validateFile(gFile)) {
      throw new BadRequestException(
        'Primary grievance document has unsupported format.',
      );
    }
    if (sFile && !validateFile(sFile)) {
      throw new BadRequestException(
        'Supporting document has unsupported format.',
      );
    }

    let gResult: any = null;
    let sResult: any = null;

    if (gFile?.buffer) {
      try {
        gResult = await this.grokScanner.scanDocument({
          buffer: gFile.buffer,
          mimeType: gFile.mimetype || 'application/octet-stream',
          filename: gFile.originalname || 'grievance-document',
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Primary doc scan fallback: ${msg}`);
        const fb = this.grokScanner.heuristicExtraction(
          '',
          gFile.originalname || 'document',
        );
        gResult = {
          extractedText: `[Primary: ${gFile.originalname}]\nScanned. Notice: ${msg}`,
          structuredData: fb,
          modelUsed: 'local-fallback',
        };
      }
    }

    if (sFile?.buffer) {
      try {
        sResult = await this.grokScanner.scanDocument({
          buffer: sFile.buffer,
          mimeType: sFile.mimetype || 'application/octet-stream',
          filename: sFile.originalname || 'supporting-document',
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Supporting doc scan fallback: ${msg}`);
        const fb = this.grokScanner.heuristicExtraction(
          '',
          sFile.originalname || 'document',
        );
        sResult = {
          extractedText: `[Supporting: ${sFile.originalname}]\nScanned. Notice: ${msg}`,
          structuredData: fb,
          modelUsed: 'local-fallback',
        };
      }
    }

    const gd = gResult?.structuredData || {};
    const sd = sResult?.structuredData || {};

    const isInvalidName = (name?: string) =>
      !name ||
      name.trim().length < 3 ||
      /^(handwritten|visitor|doc|petition|form|scan|document)/i.test(name.trim());

    let finalName = '';
    if (!isInvalidName(gd.applicantName) && !isInvalidName(sd.applicantName)) {
      finalName =
        (sd.applicantName?.length || 0) > (gd.applicantName?.length || 0)
          ? sd.applicantName!
          : gd.applicantName!;
    } else if (!isInvalidName(gd.applicantName)) {
      finalName = gd.applicantName!;
    } else if (!isInvalidName(sd.applicantName)) {
      finalName = sd.applicantName!;
    }

    const rawCategories: string[] = [];
    if (gd.category) rawCategories.push(gd.category);
    if (sd.category) rawCategories.push(sd.category);
    if (Array.isArray(gd.categories)) rawCategories.push(...gd.categories.map(String));
    if (Array.isArray(sd.categories)) rawCategories.push(...sd.categories.map(String));
    if (Array.isArray(gd.rawJson?.categories)) {
      rawCategories.push(...gd.rawJson.categories.map(String));
    }
    if (Array.isArray(sd.rawJson?.categories)) {
      rawCategories.push(...sd.rawJson.categories.map(String));
    }
    const matchedCategories = Array.from(
      new Set(
        ISSUE_CATEGORIES.filter(
          (c) =>
            c !== 'Others' &&
            rawCategories.some(
              (rc) =>
                rc.toLowerCase().includes(c.toLowerCase()) ||
                c.toLowerCase().includes(rc.toLowerCase()),
            ),
        ),
      ),
    );

    const combinedData = {
      srNumber: gd.srNumber || sd.srNumber || '',
      applicantName: finalName,
      contactNumber: gd.contactNumber || sd.contactNumber || '',
      address: gd.address || sd.address || '',
      email: gd.email || sd.email || '',
      village: gd.village || sd.village || '',
      mandal: gd.mandal || sd.mandal || '',
      division: gd.division || sd.division || '',
      assemblyConstituency:
        gd.assemblyConstituency || sd.assemblyConstituency || '',
      date: gd.date || sd.date || '',
      referenceName: gd.referenceName || sd.referenceName || '',
      referenceNumber: gd.referenceNumber || sd.referenceNumber || '',
      category: gd.category || sd.category || (matchedCategories.length > 0 ? matchedCategories.join(', ') : ''),
      categories: matchedCategories,
      others: gd.others || sd.others || '',
      actionTaken: gd.actionTaken || sd.actionTaken || '',
      actionRequested: gd.actionRequested || sd.actionRequested || '',
      assignedOfficer: gd.assignedOfficer || sd.assignedOfficer || '',
      assignedOfficerPhone:
        gd.assignedOfficerPhone || sd.assignedOfficerPhone || '',
      resolutionStatus: gd.resolutionStatus || sd.resolutionStatus || '',
      deadline: gd.deadline || sd.deadline || '',
      issueSummary: [
        gd.issueSummary,
        sd.issueSummary
          ? `[Supporting Enclosure Notes]: ${sd.issueSummary}`
          : '',
      ]
        .filter(Boolean)
        .join('\n\n'),
    };

    return {
      structuredData: combinedData,
      grievanceDoc: gFile
        ? {
            filename: gFile.originalname,
            mimeType: gFile.mimetype,
            sizeBytes: gFile.size || gFile.buffer?.length,
            extractedText: gResult?.extractedText || '',
            structuredData: gd,
            modelUsed: gResult?.modelUsed || 'grok-ai',
          }
        : null,
      supportingDoc: sFile
        ? {
            filename: sFile.originalname,
            mimeType: sFile.mimetype,
            sizeBytes: sFile.size || sFile.buffer?.length,
            extractedText: sResult?.extractedText || '',
            structuredData: sd,
            modelUsed: sResult?.modelUsed || 'grok-ai',
          }
        : null,
      modelUsed: gResult?.modelUsed || sResult?.modelUsed || 'grok-ai',
    };
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
