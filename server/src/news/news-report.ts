import ExcelJS from 'exceljs';
import type { NormalizedArticle } from '../common/types/article';

export interface ReportFilterOptions {
  sentiment?: string;
  category?: string;
  segment?: string;
  division?: string;
  source?: string;
  startDate?: string;
  endDate?: string;
  search?: string;
  periodType?: 'daily' | 'weekly' | 'monthly' | 'custom' | 'all';
}

export interface ReportStatsSummary {
  total: number;
  positive: number;
  negative: number;
  neutral: number;
  problems: number;
  bySource: Record<string, number>;
  bySegment: Record<string, number>;
  byCategory: Record<string, number>;
}

// PDF Canvas definitions matching progress-report.ts design
const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 36;
const LEFT = MARGIN;
const RIGHT = PAGE_W - MARGIN;

type Rgb = [number, number, number];
const NAVY: Rgb = [0.08, 0.16, 0.32];
const NAVY_BG: Rgb = [0.93, 0.95, 0.98];
const GREEN: Rgb = [0.12, 0.53, 0.38];
const RED: Rgb = [0.84, 0.15, 0.22];
const AMBER: Rgb = [0.85, 0.52, 0.08];
const TEXT_DARK: Rgb = [0.11, 0.15, 0.22];
const TEXT_MUTED: Rgb = [0.42, 0.48, 0.56];
const BORDER_COLOR: Rgb = [0.88, 0.91, 0.94];
const WHITE: Rgb = [1, 1, 1];
const CARD_BG: Rgb = [0.98, 0.99, 1.0];

function rgb(c: Rgb): string {
  return `${c[0].toFixed(3)} ${c[1].toFixed(3)} ${c[2].toFixed(3)} rg`;
}

function latin(text: string): string {
  // Transliterate Telugu or non-ascii to ascii-safe text for standard PDF Helvetica font
  return text
    .normalize('NFKD')
    .replace(/[^\x20-\x7E\n]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function pdfText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

function num(n: number): string {
  return n.toFixed(2);
}

function wrapText(text: string, maxLen: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = '';
  for (const w of words) {
    if (!current) {
      current = w;
    } else if (current.length + 1 + w.length <= maxLen) {
      current += ' ' + w;
    } else {
      lines.push(current);
      current = w;
    }
  }
  if (current) lines.push(current);
  return lines;
}

class PdfReportBuilder {
  private pages: string[][] = [];
  private ops: string[] = [];
  private y = PAGE_H;
  private pageNumber = 1;

  constructor(private readonly reportTitle: string) {
    this.openPage();
  }

  private openPage(): void {
    this.ops = [];
    this.rect(0, 0, PAGE_W, PAGE_H, WHITE);
    this.y = PAGE_H;
    this.drawHeader();
  }

  private drawHeader(): void {
    const bannerH = 68;
    this.rect(0, PAGE_H - bannerH, PAGE_W, bannerH, NAVY);
    this.text(
      LEFT,
      PAGE_H - 24,
      10,
      true,
      'JANAVIGNANAM CONSTITUENCY DATABASE',
      [0.8, 0.88, 0.98],
    );
    this.text(LEFT, PAGE_H - 42, 14, true, latin(this.reportTitle), WHITE);
    const dateStr = `Generated on ${new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}`;
    this.text(RIGHT - 140, PAGE_H - 24, 9, false, dateStr, [0.75, 0.82, 0.92]);
    this.y = PAGE_H - bannerH - 20;
  }

  private ensureSpace(needed: number): void {
    if (this.y - needed < 50) {
      this.drawFooter();
      this.pages.push(this.ops);
      this.pageNumber += 1;
      this.openPage();
    }
  }

  private drawFooter(): void {
    this.rect(LEFT, 36, RIGHT - LEFT, 0.6, BORDER_COLOR);
    this.text(
      LEFT,
      24,
      8,
      false,
      'JanaVignanam Official Constituency Report',
      TEXT_MUTED,
    );
    this.text(RIGHT - 50, 24, 8, false, `Page ${this.pageNumber}`, TEXT_MUTED);
  }

  rect(x: number, y: number, w: number, h: number, color: Rgb): void {
    this.ops.push(`${rgb(color)} ${num(x)} ${num(y)} ${num(w)} ${num(h)} re f`);
  }

  stroke(x: number, y: number, w: number, h: number, color: Rgb): void {
    this.ops.push(
      `${rgb(color).replace(' rg', ' RG')} 0.6 w ${num(x)} ${num(y)} ${num(w)} ${num(h)} re S`,
    );
  }

  text(
    x: number,
    y: number,
    size: number,
    bold: boolean,
    value: string,
    color: Rgb,
  ): void {
    const safe = pdfText(latin(value));
    this.ops.push(
      `BT ${rgb(color)} /${bold ? 'F2' : 'F1'} ${size} Tf 1 0 0 1 ${num(x)} ${num(y)} Tm (${safe}) Tj ET`,
    );
  }

  addFilterSummary(filters: ReportFilterOptions, totalMatching: number): void {
    this.ensureSpace(60);
    const boxH = 46;
    const bottom = this.y - boxH;
    this.rect(LEFT, bottom, RIGHT - LEFT, boxH, NAVY_BG);
    this.stroke(LEFT, bottom, RIGHT - LEFT, boxH, BORDER_COLOR);

    const fList: string[] = [];
    if (filters.segment && filters.segment !== 'all')
      fList.push(`Segment: ${filters.segment}`);
    if (filters.division && filters.division !== 'all')
      fList.push(`Division: ${filters.division}`);
    if (filters.sentiment && filters.sentiment !== 'all')
      fList.push(`Sentiment: ${filters.sentiment}`);
    if (filters.category && filters.category !== 'all')
      fList.push(`Category: ${filters.category}`);
    if (filters.source && filters.source !== 'all')
      fList.push(`Source: ${filters.source}`);
    if (filters.startDate) fList.push(`From: ${filters.startDate}`);
    if (filters.endDate) fList.push(`To: ${filters.endDate}`);
    if (filters.search) fList.push(`Search: "${filters.search}"`);

    const filterText = fList.length
      ? fList.join(' | ')
      : 'All Constituencies & Categories';
    this.text(LEFT + 12, bottom + 28, 9, true, 'APPLIED FILTERS:', NAVY);
    this.text(
      LEFT + 105,
      bottom + 28,
      9,
      false,
      filterText.slice(0, 85),
      TEXT_DARK,
    );
    this.text(
      LEFT + 12,
      bottom + 12,
      9,
      true,
      `TOTAL ARTICLES MATCHING: ${totalMatching}`,
      NAVY,
    );
    this.y = bottom - 16;
  }

  addStatCards(stats: ReportStatsSummary): void {
    this.ensureSpace(55);
    const boxW = (RIGHT - LEFT - 32) / 5;
    const boxH = 44;
    const bottom = this.y - boxH;

    const cards = [
      { label: 'TOTAL', val: String(stats.total), color: NAVY },
      { label: 'POSITIVE', val: String(stats.positive), color: GREEN },
      { label: 'NEGATIVE', val: String(stats.negative), color: RED },
      { label: 'PROBLEMS', val: String(stats.problems), color: AMBER },
      { label: 'STATEMENTS', val: String(stats.neutral), color: TEXT_MUTED },
    ];

    cards.forEach((c, idx) => {
      const bx = LEFT + idx * (boxW + 8);
      this.rect(bx, bottom, boxW, boxH, CARD_BG);
      this.stroke(bx, bottom, boxW, boxH, BORDER_COLOR);
      this.text(bx + 10, bottom + 28, 8, true, c.label, TEXT_MUTED);
      this.text(bx + 10, bottom + 10, 14, true, c.val, c.color);
    });

    this.y = bottom - 18;
  }

  addBreakdownTable(title: string, data: Record<string, number>): void {
    const entries = Object.entries(data).slice(0, 8);
    if (!entries.length) return;
    this.ensureSpace(30 + entries.length * 16);

    this.text(LEFT, this.y - 12, 11, true, title.toUpperCase(), NAVY);
    this.y -= 22;

    entries.forEach(([key, count]) => {
      this.rect(LEFT, this.y - 14, RIGHT - LEFT, 14, CARD_BG);
      this.text(LEFT + 8, this.y - 11, 9, false, key, TEXT_DARK);
      this.text(RIGHT - 40, this.y - 11, 9, true, String(count), NAVY);
      this.y -= 16;
    });
    this.y -= 10;
  }

  addArticlesList(articles: NormalizedArticle[]): void {
    this.ensureSpace(40);
    this.text(LEFT, this.y - 14, 11, true, 'ARTICLE RECORDS', NAVY);
    this.y -= 24;

    const sample = articles.slice(0, 100);
    sample.forEach((art, idx) => {
      const titleLines = wrapText(
        latin(art.title || 'Untitled Article'),
        85,
      ).slice(0, 2);
      const summaryLines = wrapText(latin(art.summary || ''), 95).slice(0, 2);
      const rowHeight =
        24 +
        titleLines.length * 12 +
        (summaryLines.length ? summaryLines.length * 11 + 4 : 0);

      this.ensureSpace(rowHeight + 8);
      const bottom = this.y - rowHeight;

      this.rect(LEFT, bottom, RIGHT - LEFT, rowHeight, WHITE);
      this.stroke(LEFT, bottom, RIGHT - LEFT, rowHeight, BORDER_COLOR);

      // Sentiment indicator strip
      const stripColor =
        art.sentiment === 'Positive'
          ? GREEN
          : art.sentiment === 'Negative'
            ? RED
            : NAVY;
      this.rect(LEFT, bottom, 4, rowHeight, stripColor);

      // Meta header: Source, Segment, Date, Sentiment
      const metaStr = `${art.source?.toUpperCase() || 'NEWS'} | ${art.assembly_segment || 'Narasaraopet'} | ${art.category || 'General'} | ${art.created_on?.slice(0, 10) || ''} | [${art.sentiment || 'Neutral'}]`;
      this.text(
        LEFT + 12,
        bottom + rowHeight - 12,
        8,
        true,
        metaStr,
        TEXT_MUTED,
      );

      // Title
      let curY = bottom + rowHeight - 24;
      titleLines.forEach((tl) => {
        this.text(LEFT + 12, curY, 9, true, tl, TEXT_DARK);
        curY -= 12;
      });

      // Summary
      summaryLines.forEach((sl) => {
        this.text(LEFT + 12, curY, 8, false, sl, TEXT_MUTED);
        curY -= 11;
      });

      this.y = bottom - 6;
    });
  }

  toBuffer(): Buffer {
    this.drawFooter();
    this.pages.push(this.ops);

    const objects: string[] = [
      '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n',
      `2 0 obj << /Type /Pages /Kids [${this.pages.map((_, index) => `${3 + index * 2} 0 R`).join(' ')}] /Count ${this.pages.length} >> endobj\n`,
    ];
    const regular = 3 + this.pages.length * 2;
    const bold = regular + 1;

    this.pages.forEach((stream, index) => {
      const pageId = 3 + index * 2;
      const contentId = pageId + 1;
      objects.push(
        `${pageId} 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Contents ${contentId} 0 R /Resources << /Font << /F1 ${regular} 0 R /F2 ${bold} 0 R >> >> >> endobj\n`,
      );
      objects.push(
        `${contentId} 0 obj << /Length ${Buffer.byteLength(stream.join('\n'))} >> stream\n${stream.join('\n')}\nendstream endobj\n`,
      );
    });

    objects.push(
      `${regular} 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\n`,
    );
    objects.push(
      `${bold} 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >> endobj\n`,
    );

    let body = '%PDF-1.4\n';
    const offsets = [0];
    for (const object of objects) {
      offsets.push(Buffer.byteLength(body));
      body += object;
    }
    const xrefAt = Buffer.byteLength(body);
    let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (let index = 1; index < offsets.length; index += 1) {
      xref += `${String(offsets[index]).padStart(10, '0')} 00000 n \n`;
    }
    body += `${xref}trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF`;
    return Buffer.from(body);
  }
}

export function generatePdfReport(
  articles: NormalizedArticle[],
  filters: ReportFilterOptions,
  stats: ReportStatsSummary,
): Buffer {
  const title = `JanaVignanam Analytics & Constituency Report`;
  const builder = new PdfReportBuilder(title);
  builder.addFilterSummary(filters, articles.length);
  builder.addStatCards(stats);
  builder.addBreakdownTable(
    'Assembly Constituency Distribution',
    stats.bySegment,
  );
  builder.addBreakdownTable('Category Distribution', stats.byCategory);
  builder.addArticlesList(articles);
  return builder.toBuffer();
}

export async function generateExcelReport(
  articles: NormalizedArticle[],
  filters: ReportFilterOptions,
  stats: ReportStatsSummary,
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'JanaVignanam';
  workbook.created = new Date();

  // Sheet 1: Articles Data
  const sheet = workbook.addWorksheet('Articles');
  sheet.columns = [
    { header: 'ID', key: '_id', width: 24 },
    { header: 'Title', key: 'title', width: 45 },
    { header: 'Source', key: 'source', width: 14 },
    { header: 'Sentiment', key: 'sentiment', width: 14 },
    { header: 'Category', key: 'category', width: 18 },
    { header: 'Assembly Segment', key: 'assembly_segment', width: 20 },
    { header: 'District', key: 'district', width: 16 },
    { header: 'Mandal', key: 'mandal', width: 18 },
    { header: 'Village', key: 'village', width: 18 },
    { header: 'Publication Date', key: 'created_on', width: 20 },
    { header: 'Source URL', key: 'source_url', width: 40 },
    { header: 'Summary', key: 'summary', width: 50 },
  ];

  // Header style
  sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  sheet.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF1E293B' },
  };

  articles.forEach((art) => {
    sheet.addRow({
      _id: art._id,
      title: art.title,
      source: art.source,
      sentiment: art.sentiment,
      category: art.category,
      assembly_segment: art.assembly_segment,
      district: art.location?.district || '',
      mandal: art.location?.mandal || '',
      village: art.location?.village || '',
      created_on: art.created_on || art.first_seen_at || '',
      source_url: art.source_url,
      summary: art.summary,
    });
  });

  // Sheet 2: Summary Stats
  const summarySheet = workbook.addWorksheet('Summary Stats');
  summarySheet.columns = [
    { header: 'Metric', key: 'metric', width: 28 },
    { header: 'Count', key: 'count', width: 16 },
  ];
  summarySheet.getRow(1).font = { bold: true };
  summarySheet.addRow({ metric: 'Total Articles', count: stats.total });
  summarySheet.addRow({ metric: 'Positive News', count: stats.positive });
  summarySheet.addRow({ metric: 'Negative News', count: stats.negative });
  summarySheet.addRow({
    metric: 'Problems & Grievances',
    count: stats.problems,
  });
  summarySheet.addRow({ metric: 'Statements & Neutral', count: stats.neutral });

  summarySheet.addRow({ metric: '', count: '' });
  summarySheet.addRow({ metric: '--- By Constituency ---', count: '' });
  Object.entries(stats.bySegment).forEach(([seg, cnt]) => {
    summarySheet.addRow({ metric: seg, count: cnt });
  });

  summarySheet.addRow({ metric: '', count: '' });
  summarySheet.addRow({ metric: '--- By Category ---', count: '' });
  Object.entries(stats.byCategory).forEach(([cat, cnt]) => {
    summarySheet.addRow({ metric: cat, count: cnt });
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

export function generateCsvReport(articles: NormalizedArticle[]): string {
  const headers = [
    'Title',
    'Source',
    'Sentiment',
    'Category',
    'Assembly Segment',
    'Mandal',
    'Village',
    'Publication Date',
    'Source URL',
    'Summary',
  ];

  const escapeCsv = (str: string) => `"${(str || '').replace(/"/g, '""')}"`;

  const rows = articles.map((a) => [
    escapeCsv(a.title),
    escapeCsv(a.source),
    escapeCsv(a.sentiment),
    escapeCsv(a.category),
    escapeCsv(a.assembly_segment),
    escapeCsv(a.location?.mandal || ''),
    escapeCsv(a.location?.village || ''),
    escapeCsv(a.created_on || a.first_seen_at || ''),
    escapeCsv(a.source_url),
    escapeCsv(a.summary),
  ]);

  return [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
}
