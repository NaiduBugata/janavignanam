import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

export const WORKSPACE_SECTIONS = [
  'grievances',
  'projects',
  'people',
  'campaigns',
  'followups',
  'schedules',
  'visits',
] as const;
export type WorkspaceSection = (typeof WORKSPACE_SECTIONS)[number];

/** Grievances, projects, constituency, and follow ups keep the visitor slip. */
export const CASE_SECTIONS = [
  'grievances',
  'projects',
  'people',
  'followups',
] as const;

export const TRACKED_SECTIONS = ['grievances', 'projects'] as const;

/** The seven assembly segments on the visitor slip. */
export const ASSEMBLY_CONSTITUENCIES = [
  'Pedakurapadu',
  'Chilakaluripet',
  'Narasaraopet',
  'Sattenapalle',
  'Vinukonda',
  'Gurazala',
  'Macherla',
] as const;

export const ISSUE_CATEGORIES = [
  'CMRF / Medical Assistance',
  'Recommendation / Request Letter',
  'Banking & Financial Issues',
  'Irrigation & Water Resources',
  'Agriculture',
  'Party / Organizational Matter',
  'TTD Recommendation Letter',
  'MPLADS',
  'Roads & Infrastructure',
  'Housing',
  'Police / Law & Order',
  'Nominated Posts',
  'Education / Fee Concession',
  'Employee Transfer',
  'Electricity',
  'Revenue & Land Issues',
  'Pension & Social Welfare',
  'Public Grievance',
  'Others',
] as const;

export const RESOLUTION_STATUSES = [
  'Pending',
  'In progress',
  'Resolved',
] as const;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const PHONE = /^(?:\+?91[\s-]?)?\d{10}$/;

function trim(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

function isCase(dto: CreateRecordDto): boolean {
  return (CASE_SECTIONS as readonly string[]).includes(dto.section);
}

function filled(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function isVisitLike(dto: CreateRecordDto): boolean {
  return dto.section === 'schedules' || dto.section === 'visits';
}

export class RegisterDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  password: string;

  @IsOptional()
  @IsString()
  name?: string;
}

export class LoginDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  password: string;
}

export class CreateRecordDto {
  @IsIn(WORKSPACE_SECTIONS)
  section: WorkspaceSection;

  @ValidateIf((dto: CreateRecordDto) => !isCase(dto))
  @Transform(({ value }) => trim(value))
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  detail?: string;

  @ValidateIf((dto: CreateRecordDto) => !isCase(dto))
  @IsOptional()
  @IsString()
  status?: string;

  @ValidateIf(isCase)
  @Transform(({ value }) => trim(value))
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  srNumber: string;

  @ValidateIf(isCase)
  @Transform(({ value }) => trim(value))
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  fullName: string;

  @ValidateIf(isCase)
  @Transform(({ value }) => trim(value))
  @Matches(PHONE, { message: 'Contact number must be a 10-digit number' })
  contactNumber: string;

  @ValidateIf(isCase)
  @Transform(({ value }) => trim(value))
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  address: string;

  @ValidateIf(isCase)
  @Transform(({ value }) => trim(value))
  @IsEmail()
  @MaxLength(120)
  email: string;

  @ValidateIf(isCase)
  @Transform(({ value }) => trim(value))
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  village: string;

  @ValidateIf(isCase)
  @Transform(({ value }) => trim(value))
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  mandal: string;

  @IsOptional()
  @Transform(({ value }) => trim(value))
  @IsString()
  @MaxLength(80)
  division?: string;

  @ValidateIf(isCase)
  @IsIn(ASSEMBLY_CONSTITUENCIES)
  assemblyConstituency: (typeof ASSEMBLY_CONSTITUENCIES)[number];

  @ValidateIf((dto: CreateRecordDto) => isCase(dto) && filled(dto.dateOfVisit))
  @Matches(DATE, { message: 'Date of visit must be a date' })
  dateOfVisit?: string;

  @ValidateIf(
    (dto: CreateRecordDto) => isCase(dto) && filled(dto.referenceName),
  )
  @Transform(({ value }) => trim(value))
  @IsString()
  @MaxLength(120)
  referenceName?: string;

  @ValidateIf(
    (dto: CreateRecordDto) => isCase(dto) && filled(dto.referenceNumber),
  )
  @Transform(({ value }) => trim(value))
  @IsString()
  @MaxLength(40)
  referenceNumber?: string;

  @ValidateIf(isCase)
  @IsArray()
  @ArrayMinSize(1)
  @IsIn(ISSUE_CATEGORIES, { each: true })
  categories: string[];

  @ValidateIf(
    (dto: CreateRecordDto) =>
      isCase(dto) &&
      Array.isArray(dto.categories) &&
      dto.categories.includes('Others'),
  )
  @Transform(({ value }) => trim(value))
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  others?: string;

  @ValidateIf(isCase)
  @Transform(({ value }) => trim(value))
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  actionTaken: string;

  @ValidateIf(isCase)
  @Transform(({ value }) => trim(value))
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  actionToBeTaken: string;

  @ValidateIf(isCase)
  @Transform(({ value }) => trim(value))
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  assignedOfficer: string;

  @ValidateIf(isCase)
  @IsIn(RESOLUTION_STATUSES)
  resolutionStatus: (typeof RESOLUTION_STATUSES)[number];

  @ValidateIf(isCase)
  @Matches(DATE, { message: 'Deadline must be a date' })
  deadline: string;

  @ValidateIf(isVisitLike)
  @Transform(({ value }) => trim(value))
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  place?: string;

  @ValidateIf(isVisitLike)
  @Matches(DATE, { message: 'Date must be a date' })
  visitDate?: string;

  @ValidateIf(isVisitLike)
  @Transform(({ value }) => trim(value))
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  visitTime?: string;

  @ValidateIf(
    (dto: CreateRecordDto) =>
      dto.section === 'visits' &&
      typeof dto.leadPhone === 'string' &&
      dto.leadPhone.trim() !== '',
  )
  @Transform(({ value }) => trim(value))
  @Matches(PHONE, { message: 'Lead phone must be a 10-digit number' })
  leadPhone?: string;
}

export const STAGE_STATUSES = ['Pending', 'In progress', 'Completed'] as const;
export const PROGRESS_STATUSES = [
  'Pending',
  'In progress',
  'Completed',
  'Resolved',
  'Open',
  'Reviewed',
  'Approved',
] as const;

export class ProgressStageDto {
  @Transform(({ value }) => trim(value))
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name: string;

  @IsIn(STAGE_STATUSES)
  status: (typeof STAGE_STATUSES)[number];

  @IsOptional()
  @Transform(({ value }) => trim(value))
  @IsString()
  @MaxLength(300)
  note?: string;
}

export class UpdateProgressDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(12)
  @ValidateNested({ each: true })
  @Type(() => ProgressStageDto)
  stages?: ProgressStageDto[];

  @IsOptional()
  @Transform(({ value }) => trim(value))
  @IsIn(PROGRESS_STATUSES, { message: 'Invalid status' })
  status?: (typeof PROGRESS_STATUSES)[number];

  @IsOptional()
  @Transform(({ value }) => trim(value))
  @IsString()
  @MaxLength(1000)
  remarks?: string;

  @IsOptional()
  @Transform(({ value }) => trim(value))
  @IsString()
  @MaxLength(120)
  department?: string;
}
