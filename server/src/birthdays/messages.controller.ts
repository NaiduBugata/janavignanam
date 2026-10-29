import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { AdminOnly } from '../common/decorators/admin.decorator';
import { ContactMessagesService, MAX_RECIPIENTS } from './messages.service';

export class SendMessageDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_RECIPIENTS)
  @IsString({ each: true })
  contactIds: string[];

  @IsIn(['text', 'template'])
  kind: 'text' | 'template';

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  text?: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  template?: string;

  @IsOptional()
  @IsString()
  @MaxLength(15)
  language?: string;

  @IsOptional()
  @IsObject()
  params?: Record<string, string>;
}

@Controller('api/admin/messages')
@AdminOnly()
export class MessagesController {
  constructor(private readonly messages: ContactMessagesService) {}

  @Get()
  async history() {
    return { messages: await this.messages.history() };
  }

  @Get('templates')
  async templates() {
    return { templates: await this.messages.templates() };
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  async send(@Body() body: SendMessageDto) {
    return { results: await this.messages.send(body) };
  }
}
