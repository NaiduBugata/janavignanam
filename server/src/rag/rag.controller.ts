import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import { QueryRagDto, RagResponse } from './rag.dto';
import { RagService } from './rag.service';

@Controller('api/rag')
export class RagController {
  constructor(private readonly ragService: RagService) {}

  @Post('query')
  @HttpCode(HttpStatus.OK)
  async query(@Body() dto: QueryRagDto): Promise<RagResponse> {
    return this.ragService.query(dto);
  }

  @Get('documents')
  async listDocuments(): Promise<Array<Record<string, unknown>>> {
    return this.ragService.getDocuments();
  }

  @Get('status')
  async status(): Promise<Record<string, unknown>> {
    const python = await this.ragService.checkPythonEngineHealth();
    return {
      status: 'ok',
      python_engine_connected: python.available,
      active_engine: python.available ? 'python-rag' : 'native-rag',
      details: python.data || null,
    };
  }
}
