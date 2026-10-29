import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { AdminOnly } from '../common/decorators/admin.decorator';
import {
  birthdayWishesEnabled,
  todayInIndia,
  wishHour,
  wishTemplate,
} from './birthdays';
import { BirthdaysService } from './birthdays.service';

export class CreateBirthdayDto {
  @IsString()
  @MaxLength(80)
  name: string;

  @IsString()
  @MaxLength(20)
  phone: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  birthday?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  place?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  designation?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  @IsOptional()
  @IsIn(['en', 'te'])
  language?: string;
}

export class RepliesDto {
  @IsBoolean()
  allowReplies: boolean;
}

@Controller('api/admin/birthdays')
@AdminOnly()
export class BirthdaysController {
  constructor(private readonly birthdays: BirthdaysService) {}

  @Get()
  async list() {
    return {
      contacts: await this.birthdays.list(),
      today: todayInIndia(),
      automatic: birthdayWishesEnabled(),
      hour: wishHour(),
      templates: { en: wishTemplate('en').name, te: wishTemplate('te').name },
    };
  }

  @Post()
  async create(@Body() body: CreateBirthdayDto) {
    return { contact: await this.birthdays.create(body) };
  }

  @Patch(':id/replies')
  async replies(@Param('id') id: string, @Body() body: RepliesDto) {
    return { contact: await this.birthdays.setReplies(id, body.allowReplies) };
  }

  @Post(':id/send')
  @HttpCode(HttpStatus.OK)
  async send(@Param('id') id: string) {
    return { contact: await this.birthdays.sendNow(id) };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  async remove(@Param('id') id: string) {
    await this.birthdays.remove(id);
    return { status: 'deleted' };
  }
}
