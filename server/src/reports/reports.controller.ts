import { Body, Controller, Get, Param, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { previousReportDay } from './report-stats';
import { ReportsService } from './reports.service';

interface ReportBody {
  date?: string;
  force?: boolean;
}

function parseReportDate(value: unknown): string | null {
  if (!value) return null;
  const text = String(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const parsed = new Date(`${text}T00:00:00Z`);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== text
  )
    return null;
  return text;
}

@Controller('api/reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('history')
  async history(
    @Query('limit') limit = '60',
    @Res({ passthrough: true }) res: Response,
  ) {
    try {
      const parsed = Number.parseInt(String(limit), 10);
      if (!Number.isFinite(parsed)) throw new Error('bad limit');
      return { reports: await this.reports.history(parsed) };
    } catch {
      res.status(500);
      return { error: 'Failed to fetch report history', reports: [] };
    }
  }

  @Post('send-now')
  async sendNow(
    @Body() body: ReportBody,
    @Res({ passthrough: true }) res: Response,
  ) {
    try {
      const result = await this.reports.generateAndSend(
        parseReportDate(body?.date),
        {
          force: Boolean(body?.force),
        },
      );
      res.status(
        result.status === 'sent' || result.status === 'skipped' ? 200 : 502,
      );
      return result;
    } catch (err) {
      res.status(500);
      return {
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  @Post('regenerate')
  async regenerate(
    @Body() body: ReportBody,
    @Res({ passthrough: true }) res: Response,
  ) {
    try {
      const result = await this.reports.generateAndSend(
        parseReportDate(body?.date) || previousReportDay(),
        {
          force: true,
        },
      );
      res.status(result.status === 'sent' ? 200 : 502);
      return result;
    } catch (err) {
      res.status(500);
      return {
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  @Get(':reportId')
  async detail(
    @Param('reportId') reportId: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    try {
      const doc = await this.reports.getById(reportId);
      if (!doc) {
        res.status(404);
        return { error: 'Report not found' };
      }
      return doc;
    } catch (err) {
      res.status(500);
      return { error: err instanceof Error ? err.message : String(err) };
    }
  }
}
