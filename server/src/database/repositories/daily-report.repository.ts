import { Injectable } from '@nestjs/common';
import { Document, ObjectId } from 'mongodb';
import { DatabaseService } from '../database.service';

const COLLECTION = 'daily_reports';

@Injectable()
export class DailyReportRepository {
  constructor(private readonly db: DatabaseService) {}

  async latest(): Promise<Document | null> {
    try {
      const rows = await this.db
        .collection(COLLECTION)
        .find({})
        .sort({ report_date: -1 })
        .limit(1)
        .toArray();
      return rows[0] || null;
    } catch {
      return null;
    }
  }

  private collection() {
    return this.db.collection(COLLECTION);
  }

  async findByDate(reportDate: string): Promise<Document | null> {
    await this.db.ensureConnected();
    return this.collection().findOne({ report_date: reportDate });
  }

  async alreadySent(reportDate: string): Promise<boolean> {
    const doc = await this.findByDate(reportDate);
    return doc?.status === 'sent';
  }

  async upsert(
    reportDate: string,
    fields: Record<string, unknown>,
  ): Promise<Document | null> {
    await this.db.ensureConnected();
    const now = new Date().toISOString();
    await this.collection().updateOne(
      { report_date: reportDate },
      {
        $set: { ...fields, updated_at: now },
        $setOnInsert: { created_at: now },
      },
      { upsert: true },
    );
    return this.collection().findOne({ report_date: reportDate });
  }

  async recordGeneration(
    reportDate: string,
    stats: {
      total?: number;
      problems?: number;
      positive?: number;
      negative?: number;
      high_priority_problems?: number;
    },
    recipients: string[],
    pdfPath: string,
  ): Promise<Document | null> {
    return this.upsert(reportDate, {
      generated_time: new Date().toISOString(),
      recipients,
      articles_included: stats.total || 0,
      problems_count: stats.problems || 0,
      positive_count: stats.positive || 0,
      negative_count: stats.negative || 0,
      high_priority_problems: stats.high_priority_problems || 0,
      pdf_path: pdfPath,
      status: 'pending',
    });
  }

  async recordSent(
    reportDate: string,
    retryCount: number,
  ): Promise<Document | null> {
    return this.upsert(reportDate, {
      status: 'sent',
      sent_time: new Date().toISOString(),
      retry_count: retryCount,
      error: null,
    });
  }

  async recordFailed(
    reportDate: string,
    retryCount: number,
    error: string,
  ): Promise<Document | null> {
    return this.upsert(reportDate, {
      status: 'failed',
      retry_count: retryCount,
      error,
    });
  }

  async history(limit = 60): Promise<Document[]> {
    await this.db.ensureConnected();
    const rows = await this.collection()
      .find({})
      .sort({ report_date: -1 })
      .limit(limit)
      .toArray();
    return rows.map(serializeReport);
  }

  async getById(reportId: string): Promise<Document | null> {
    await this.db.ensureConnected();
    let doc: Document | null = null;
    if (/^[a-f0-9]{24}$/i.test(reportId)) {
      try {
        doc = await this.collection().findOne({ _id: new ObjectId(reportId) });
      } catch {
        doc = null;
      }
    }
    if (!doc) doc = await this.collection().findOne({ report_date: reportId });
    return doc ? serializeReport(doc) : null;
  }
}

function serializeReport(doc: Document): Document {
  const result = { ...doc };
  if (result._id) result._id = String(result._id);
  return result;
}
