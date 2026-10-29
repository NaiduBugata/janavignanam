import {
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { PipelineStateRepository } from '../database/repositories/pipeline-state.repository';

@Controller('api')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly pipelineState: PipelineStateRepository,
  ) {}

  @Get('health')
  async health() {
    // Always probe Mongo (with reconnect). Contract: { status: "ok", mongo: bool }
    let mongo = false;
    try {
      mongo = await this.db.ensureConnected();
      if (mongo) {
        await this.db.ping();
        mongo = true;
      }
    } catch {
      mongo = false;
    }
    return { status: 'ok', mongo };
  }

  @Get('database/health')
  async databaseHealth() {
    try {
      const ping = await this.pipelineState.pingDiagnostics();
      return {
        status: 'healthy',
        ok: true,
        latency_ms: ping.latency_ms,
        database: ping.database,
        articles_collection: ping.articles_collection,
        articles_count: ping.articles_count,
      };
    } catch (err) {
      this.logger.error(
        'database health failed',
        err instanceof Error ? err.stack : err,
      );
      throw new HttpException(
        {
          status: 'unhealthy',
          ok: false,
          error: 'unavailable',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
