import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
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

@Controller('api/workspace')
export class WorkspaceController {
  constructor(private readonly workspace: WorkspaceService) {}

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
    @Query('role') role = '',
    @Query('page') page = '1',
    @Headers('authorization') authorization?: string,
  ) {
    this.workspace.verify(bearer(authorization));
    return queryContacts({
      q,
      division,
      assembly,
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
