import {
  Controller,
  Get,
  Header,
  HttpException,
  HttpStatus,
  Logger,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { NewsService } from './news.service';
import type { ReportFilterOptions } from './news-report';

function sendReportFile(
  res: Response,
  name: string,
  type: string,
  bytes: Buffer,
) {
  res.setHeader('Content-Type', type);
  res.setHeader('Content-Length', String(bytes.length));
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${name.replace(/"/g, '')}"`,
  );
  res.end(bytes);
}

@Controller('api/news')
export class NewsController {
  private readonly logger = new Logger(NewsController.name);

  constructor(private readonly newsService: NewsService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  async getNews(
    @Query('source') source = 'all',
    @Query('sentiment') sentiment?: string,
    @Query('segment') segment?: string,
    @Query('division') division?: string,
    @Query('category') category?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('search') search?: string,
    @Query('periodType')
    periodType?: 'daily' | 'weekly' | 'monthly' | 'custom' | 'all',
    @Res({ passthrough: true }) res?: Response,
  ) {
    try {
      const filters: ReportFilterOptions = {
        source,
        sentiment,
        segment,
        division,
        category,
        startDate,
        endDate,
        search,
        periodType,
      };
      return await this.newsService.listNews(filters);
    } catch (err) {
      this.logger.error(
        'Failed to fetch news',
        err instanceof Error ? err.stack : err,
      );
      if (res) res.setHeader('Cache-Control', 'no-store');
      throw new HttpException(
        { error: 'Failed to fetch news', articles: [], count: 0 },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('stats')
  @Header('Cache-Control', 'no-store')
  async getStats(
    @Query('source') source?: string,
    @Query('sentiment') sentiment?: string,
    @Query('segment') segment?: string,
    @Query('division') division?: string,
    @Query('category') category?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('search') search?: string,
    @Res({ passthrough: true }) res?: Response,
  ) {
    try {
      const filters: ReportFilterOptions = {
        source,
        sentiment,
        segment,
        division,
        category,
        startDate,
        endDate,
        search,
      };
      return await this.newsService.getStats(filters);
    } catch (err) {
      this.logger.error(
        'Failed to fetch stats',
        err instanceof Error ? err.stack : err,
      );
      if (res) res.setHeader('Cache-Control', 'no-store');
      throw new HttpException(
        { error: 'Failed to fetch stats' },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('reports/export')
  async exportReport(
    @Query('format') format = 'pdf',
    @Query('source') source?: string,
    @Query('sentiment') sentiment?: string,
    @Query('segment') segment?: string,
    @Query('division') division?: string,
    @Query('category') category?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('search') search?: string,
    @Query('periodType')
    periodType?: 'daily' | 'weekly' | 'monthly' | 'custom' | 'all',
    @Res() res?: Response,
  ) {
    try {
      const validFormat =
        format.toLowerCase() === 'xlsx'
          ? 'xlsx'
          : format.toLowerCase() === 'csv'
            ? 'csv'
            : 'pdf';
      const filters: ReportFilterOptions = {
        source,
        sentiment,
        segment,
        division,
        category,
        startDate,
        endDate,
        search,
        periodType,
      };
      const file = await this.newsService.exportReport(filters, validFormat);
      if (res) {
        sendReportFile(res, file.name, file.type, file.bytes);
      }
    } catch (err) {
      this.logger.error(
        'Failed to export report',
        err instanceof Error ? err.stack : err,
      );
      throw new HttpException(
        { error: 'Failed to export report' },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
