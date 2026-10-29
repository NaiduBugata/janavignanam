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

// PDF Canvas definitions matching executive-level constituency report design
const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 36;
const LEFT = MARGIN;
const RIGHT = PAGE_W - MARGIN;

type Rgb = [number, number, number];
const NAVY: Rgb = [0.08, 0.16, 0.32]; // #142952
const NAVY_BG: Rgb = [0.94, 0.96, 0.98]; // #F0F4F9
const GREEN: Rgb = [0.063, 0.725, 0.506]; // #10B981
const RED: Rgb = [0.937, 0.267, 0.267]; // #EF4444
const AMBER: Rgb = [0.961, 0.620, 0.043]; // #F59E0B
const SLATE: Rgb = [0.392, 0.455, 0.545]; // #64748B
const TEXT_DARK: Rgb = [0.06, 0.09, 0.16]; // #0F172A
const TEXT_MUTED: Rgb = [0.42, 0.48, 0.56]; // #6B7A8F
const BORDER_COLOR: Rgb = [0.88, 0.91, 0.94]; // #E2E8F0
const WHITE: Rgb = [1, 1, 1];
const CARD_BG: Rgb = [0.98, 0.99, 1.0];

function rgb(c: Rgb): string {
  return `${c[0].toFixed(3)} ${c[1].toFixed(3)} ${c[2].toFixed(3)} rg`;
}

/**
 * Phonetically transliterates Telugu Unicode script (\u0C00 - \u0C7F) into readable
 * Latin characters, and normalizes smart punctuation and currency symbols for PDF Helvetica.
 * Preserves all ASCII English words, digits, and standard symbols.
 */
export function transliterateTeluguToLatin(text: string): string {
  if (!text) return '';

  const vowels: Record<number, string> = {
    0x0c05: 'a',
    0x0c06: 'aa',
    0x0c07: 'i',
    0x0c08: 'ee',
    0x0c09: 'u',
    0x0c0a: 'oo',
    0x0c0b: 'ru',
    0x0c60: 'roo',
    0x0c0c: 'lu',
    0x0c61: 'loo',
    0x0c0e: 'e',
    0x0c0f: 'ee',
    0x0c10: 'ai',
    0x0c12: 'o',
    0x0c13: 'oo',
    0x0c14: 'au',
  };

  const consonants: Record<number, string> = {
    0x0c15: 'k',
    0x0c16: 'kh',
    0x0c17: 'g',
    0x0c18: 'gh',
    0x0c19: 'ng',
    0x0c1a: 'ch',
    0x0c1b: 'chh',
    0x0c1c: 'j',
    0x0c1d: 'jh',
    0x0c1e: 'ny',
    0x0c1f: 't',
    0x0c20: 'th',
    0x0c21: 'd',
    0x0c22: 'dh',
    0x0c23: 'n',
    0x0c24: 't',
    0x0c25: 'th',
    0x0c26: 'd',
    0x0c27: 'dh',
    0x0c28: 'n',
    0x0c2a: 'p',
    0x0c2b: 'ph',
    0x0c2c: 'b',
    0x0c2d: 'bh',
    0x0c2e: 'm',
    0x0c2f: 'y',
    0x0c30: 'r',
    0x0c31: 'r',
    0x0c32: 'l',
    0x0c33: 'l',
    0x0c34: 'zh',
    0x0c35: 'v',
    0x0c36: 'sh',
    0x0c37: 'sh',
    0x0c38: 's',
    0x0c39: 'h',
  };

  const matras: Record<number, string> = {
    0x0c3e: 'aa',
    0x0c3f: 'i',
    0x0c40: 'ee',
    0x0c41: 'u',
    0x0c42: 'oo',
    0x0c43: 'ru',
    0x0c44: 'roo',
    0x0c46: 'e',
    0x0c47: 'ee',
    0x0c48: 'ai',
    0x0c4a: 'o',
    0x0c4b: 'oo',
    0x0c4c: 'au',
  };

  // Smart punctuation & common unicode symbols
  const s = text
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\u2026/g, '...')
    .replace(/\u20B9/g, 'Rs. ')
    .replace(/[\u2022\u2023\u25E6\u2043\u2219]/g, '* ')
    .replace(/\u00A0/g, ' ');

  let out = '';
  const len = s.length;
  for (let i = 0; i < len; i += 1) {
    const code = s.charCodeAt(i);

    // Telugu digits 0x0C66 - 0x0C6F
    if (code >= 0x0c66 && code <= 0x0c6f) {
      out += String(code - 0x0c66);
      continue;
    }

    // Independent Vowels
    if (vowels[code]) {
      out += vowels[code];
      continue;
    }

    // Consonants
    if (consonants[code]) {
      const c = consonants[code];
      const nextCode = i + 1 < len ? s.charCodeAt(i + 1) : 0;
      if (nextCode === 0x0c4d) {
        // Virama (halant) - suppress inherent 'a'
        out += c;
        i += 1;
      } else if (matras[nextCode]) {
        // Matra vowel sign
        out += c + matras[nextCode];
        i += 1;
      } else {
        // Inherent 'a'
        out += c + 'a';
      }
      continue;
    }

    // Anusvara
    if (code === 0x0c02 || code === 0x0c01) {
      out += 'm';
      continue;
    }

    // Visarga
    if (code === 0x0c03) {
      out += 'h';
      continue;
    }

    // Standalone Matra or Virama fallback
    if (matras[code]) {
      out += matras[code];
      continue;
    }
    if (code === 0x0c4d) {
      continue;
    }

    // Standard ASCII
    if (code >= 0x20 && code <= 0x7e) {
      out += s[i];
    } else if (code === 0x0a || code === 0x0d) {
      out += '\n';
    } else {
      // General Unicode NFKD fallback
      const nfkd = s[i].normalize('NFKD').replace(/[^\x20-\x7E]/g, '');
      if (nfkd) out += nfkd;
    }
  }

  return out.replace(/\s+/g, ' ').trim();
}

export function sanitizeTextForPdf(text: string): string {
  return transliterateTeluguToLatin(text || '');
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

    if (this.pageNumber === 1) {
      // Primary Cover Banner
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
      this.text(
        LEFT,
        PAGE_H - 44,
        14,
        true,
        sanitizeTextForPdf(this.reportTitle),
        WHITE,
      );
      const dateStr = `Generated on ${new Date().toLocaleDateString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      })}`;
      this.text(
        RIGHT - 145,
        PAGE_H - 24,
        9,
        false,
        dateStr,
        [0.75, 0.82, 0.92],
      );
      this.y = PAGE_H - bannerH - 20;
    } else {
      // Continuation Header
      const headerH = 34;
      this.rect(0, PAGE_H - headerH, PAGE_W, headerH, NAVY_BG);
      this.rect(0, PAGE_H - headerH, PAGE_W, 0.6, BORDER_COLOR);
      this.text(
        LEFT,
        PAGE_H - 22,
        9,
        true,
        'JANAVIGNANAM CONSTITUENCY DATABASE',
        NAVY,
      );
      this.text(
        LEFT + 220,
        PAGE_H - 22,
        8,
        false,
        `|  ${sanitizeTextForPdf(this.reportTitle).slice(0, 48)}`,
        TEXT_MUTED,
      );
      this.y = PAGE_H - headerH - 18;
    }
  }

  private ensureSpace(needed: number): void {
    if (this.y - needed < 50) {
      this.pages.push(this.ops);
      this.pageNumber += 1;
      this.openPage();
    }
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
    const safe = pdfText(sanitizeTextForPdf(value));
    this.ops.push(
      `BT ${rgb(color)} /${bold ? 'F2' : 'F1'} ${size} Tf 1 0 0 1 ${num(x)} ${num(y)} Tm (${safe}) Tj ET`,
    );
  }

  addFilterSummary(filters: ReportFilterOptions, totalMatching: number): void {
    this.ensureSpace(62);
    const boxH = 48;
    const bottom = this.y - boxH;
    this.rect(LEFT, bottom, RIGHT - LEFT, boxH, NAVY_BG);
    this.stroke(LEFT, bottom, RIGHT - LEFT, boxH, BORDER_COLOR);

    const fList: string[] = [];
    if (filters.segment && filters.segment !== 'all')
      fList.push(`Segment: ${filters.segment}`);
    if (filters.division && filters.division !== 'all')
      fList.push(`Division: ${filters.division}`);
    if (filters.sentiment && filters.sentiment !== 'all')
      fList.push(`Category: ${filters.sentiment}`);
    if (filters.category && filters.category !== 'all')
      fList.push(`Sector: ${filters.category}`);
    if (filters.source && filters.source !== 'all')
      fList.push(`Source: ${filters.source}`);

    // Date range formatting
    if (filters.startDate && filters.endDate) {
      if (filters.startDate === filters.endDate) {
        fList.push(`Date: ${filters.startDate}`);
      } else {
        fList.push(`Period: ${filters.startDate} to ${filters.endDate}`);
      }
    } else if (filters.startDate) {
      fList.push(`From: ${filters.startDate}`);
    } else if (filters.endDate) {
      fList.push(`To: ${filters.endDate}`);
    } else {
      fList.push('Period: All Available Records');
    }

    if (filters.search) fList.push(`Keyword: "${filters.search}"`);

    const filterText = fList.join('  |  ');
    this.text(LEFT + 12, bottom + 30, 9, true, 'APPLIED CONSTITUENCY FILTERS:', NAVY);
    this.text(
      LEFT + 12,
      bottom + 16,
      8.5,
      false,
      filterText.slice(0, 110),
      TEXT_DARK,
    );
    this.text(
      RIGHT - 180,
      bottom + 30,
      9,
      true,
      `TOTAL MATCHING: ${totalMatching}`,
      NAVY,
    );
    this.y = bottom - 16;
  }

  addStatCards(stats: ReportStatsSummary, activeSentiment?: string): void {
    this.ensureSpace(55);
    const boxW = (RIGHT - LEFT - 32) / 5;
    const boxH = 44;
    const bottom = this.y - boxH;

    const total = stats.total || 1;
    const pct = (n: number) =>
      stats.total > 0 ? ` (${Math.round((n / total) * 100)}%)` : '';

    const cards = [
      { label: 'TOTAL', val: String(stats.total), color: NAVY, sub: 'All' },
      {
        label: 'POSITIVE',
        val: `${stats.positive}${pct(stats.positive)}`,
        color: GREEN,
        sub: 'Growth',
      },
      {
        label: 'NEGATIVE',
        val: `${stats.negative}${pct(stats.negative)}`,
        color: RED,
        sub: 'Issues',
      },
      {
        label: 'PROBLEMS',
        val: `${stats.problems}${pct(stats.problems)}`,
        color: AMBER,
        sub: 'Grievance',
      },
      {
        label: 'STATEMENTS',
        val: `${stats.neutral}${pct(stats.neutral)}`,
        color: SLATE,
        sub: 'Neutral',
      },
    ];

    cards.forEach((c, idx) => {
      const bx = LEFT + idx * (boxW + 8);
      this.rect(bx, bottom, boxW, boxH, CARD_BG);
      this.stroke(bx, bottom, boxW, boxH, BORDER_COLOR);
      this.text(bx + 8, bottom + 28, 7.5, true, c.label, TEXT_MUTED);
      this.text(bx + 8, bottom + 11, 11.5, true, c.val, c.color);
    });

    this.y = bottom - 18;
  }

  addBreakdownTable(title: string, data: Record<string, number>): void {
    const entries = Object.entries(data).slice(0, 8);
    if (!entries.length) return;
    this.ensureSpace(28 + entries.length * 15);

    this.text(LEFT, this.y - 12, 10, true, title.toUpperCase(), NAVY);
    this.y -= 20;

    entries.forEach(([key, count], index) => {
      const rowBg = index % 2 === 0 ? CARD_BG : WHITE;
      this.rect(LEFT, this.y - 14, RIGHT - LEFT, 14, rowBg);
      this.stroke(LEFT, this.y - 14, RIGHT - LEFT, 14, BORDER_COLOR);
      this.text(LEFT + 8, this.y - 10.5, 8.5, false, key, TEXT_DARK);
      this.text(RIGHT - 40, this.y - 10.5, 8.5, true, String(count), NAVY);
      this.y -= 15;
    });
    this.y -= 10;
  }

  addArticlesList(articles: NormalizedArticle[]): void {
    this.ensureSpace(40);
    this.text(
      LEFT,
      this.y - 14,
      11,
      true,
      `ARTICLE RECORDS (${articles.length} TOTAL)`,
      NAVY,
    );
    this.y -= 24;

    // Render ALL articles (no arbitrary slicing)
    articles.forEach((art) => {
      const rawTitle = art.title || 'Untitled Article';
      const cleanTitle = sanitizeTextForPdf(rawTitle);
      const titleLines = wrapText(cleanTitle, 80).slice(0, 3);

      const rawSummary =
        art.summary ||
        (art as any).description ||
        (art as any).article_body ||
        (art as any).content ||
        'Summary not available';
      const cleanSummary = sanitizeTextForPdf(rawSummary);
      const summaryLines = wrapText(cleanSummary, 95).slice(0, 4);

      const hasUrl = Boolean(art.source_url);
      const rowHeight =
        26 +
        titleLines.length * 12 +
        (summaryLines.length ? summaryLines.length * 10.5 + 4 : 0) +
        (hasUrl ? 11 : 0);

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
            : art.sentiment === 'Problem'
              ? AMBER
              : SLATE;
      this.rect(LEFT, bottom, 4, rowHeight, stripColor);

      // Metadata header row
      const src = (art.source || 'News').toUpperCase();
      const seg = art.assembly_segment || 'Narasaraopet';
      const mandal = art.location?.mandal ? ` > ${art.location.mandal}` : '';
      const cat = art.category || 'General';
      const date = (art.created_on || art.first_seen_at || '').slice(0, 10);
      const sent = art.sentiment || 'Neutral';
      const metaStr = `${src} | ${seg}${mandal} | ${cat} | ${date} | [${sent}]`;

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
        curY -= 10.5;
      });

      // Source Link reference if available
      if (hasUrl && art.source_url) {
        this.text(
          LEFT + 12,
          bottom + 4,
          7.5,
          false,
          `Source: ${art.source_url.slice(0, 90)}`,
          NAVY,
        );
      }

      this.y = bottom - 6;
    });
  }

  toBuffer(): Buffer {
    // Push the active page operations
    this.pages.push(this.ops);
    const totalPages = this.pages.length;

    // Inject "Page X of Y" and footer divider into every page stream
    this.pages.forEach((pageOps, index) => {
      const pageNum = index + 1;
      const footerOps = [
        `${rgb(BORDER_COLOR).replace(' rg', ' RG')} 0.6 w ${num(LEFT)} 36 ${num(RIGHT - LEFT)} 0.6 re S`,
        `BT ${rgb(TEXT_MUTED)} /F1 8 Tf 1 0 0 1 ${num(LEFT)} 24 Tm (${pdfText('JanaVignanam Official Constituency Intelligence Report')}) Tj ET`,
        `BT ${rgb(TEXT_MUTED)} /F1 8 Tf 1 0 0 1 ${num(RIGHT - 65)} 24 Tm (${pdfText(`Page ${pageNum} of ${totalPages}`)}) Tj ET`,
      ];
      pageOps.push(...footerOps);
    });

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
  let title = 'JanaVignanam Analytics - Overall Comprehensive Report';
  if (filters.sentiment) {
    const s = filters.sentiment.toLowerCase();
    if (s === 'positive') title = 'JanaVignanam Analytics - Positive News Report';
    else if (s === 'negative')
      title = 'JanaVignanam Analytics - Negative News Report';
    else if (s === 'problems' || s === 'problem')
      title = 'JanaVignanam Analytics - Public Grievances & Problems Report';
    else if (s === 'neutral' || s === 'statement' || s === 'statements')
      title = 'JanaVignanam Analytics - Statements & Neutral News Report';
  } else if (filters.category && filters.category !== 'all') {
    title = `JanaVignanam Analytics - ${filters.category} Report`;
  }

  const builder = new PdfReportBuilder(title);
  builder.addFilterSummary(filters, articles.length);
  builder.addStatCards(stats, filters.sentiment);
  builder.addBreakdownTable(
    'Assembly Constituency Distribution',
    stats.bySegment,
  );
  builder.addBreakdownTable('News Category Distribution', stats.byCategory);
  builder.addBreakdownTable('Source Distribution', stats.bySource);
  builder.addArticlesList(articles);
  return builder.toBuffer();
}

export async function generateExcelReport(
  articles: NormalizedArticle[],
  filters: ReportFilterOptions,
  stats: ReportStatsSummary,
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'JanaVignanam Intelligence';
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
    { header: 'Source URL', key: 'source_url', width: 45 },
    { header: 'Summary', key: 'summary', width: 60 },
  ];

  // Header styling
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
      summary:
        art.summary ||
        (art as any).description ||
        (art as any).article_body ||
        (art as any).content ||
        '',
    });
  });

  // Sheet 2: Summary Stats
  const summarySheet = workbook.addWorksheet('Summary Stats');
  summarySheet.columns = [
    { header: 'Metric', key: 'metric', width: 32 },
    { header: 'Count', key: 'count', width: 16 },
    { header: 'Percentage', key: 'percentage', width: 16 },
  ];
  summarySheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  summarySheet.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF1E293B' },
  };

  const total = stats.total || 1;
  const pctStr = (cnt: number) =>
    stats.total > 0 ? `${((cnt / total) * 100).toFixed(1)}%` : '0%';

  summarySheet.addRow({
    metric: 'Total Articles',
    count: stats.total,
    percentage: '100%',
  });
  summarySheet.addRow({
    metric: 'Positive News',
    count: stats.positive,
    percentage: pctStr(stats.positive),
  });
  summarySheet.addRow({
    metric: 'Negative News',
    count: stats.negative,
    percentage: pctStr(stats.negative),
  });
  summarySheet.addRow({
    metric: 'Problems & Grievances',
    count: stats.problems,
    percentage: pctStr(stats.problems),
  });
  summarySheet.addRow({
    metric: 'Statements & Neutral',
    count: stats.neutral,
    percentage: pctStr(stats.neutral),
  });

  summarySheet.addRow({ metric: '', count: '', percentage: '' });
  summarySheet.addRow({
    metric: '--- By Assembly Segment ---',
    count: '',
    percentage: '',
  });
  Object.entries(stats.bySegment).forEach(([seg, cnt]) => {
    summarySheet.addRow({
      metric: seg,
      count: cnt,
      percentage: pctStr(cnt),
    });
  });

  summarySheet.addRow({ metric: '', count: '', percentage: '' });
  summarySheet.addRow({
    metric: '--- By News Category ---',
    count: '',
    percentage: '',
  });
  Object.entries(stats.byCategory).forEach(([cat, cnt]) => {
    summarySheet.addRow({
      metric: cat,
      count: cnt,
      percentage: pctStr(cnt),
    });
  });

  summarySheet.addRow({ metric: '', count: '', percentage: '' });
  summarySheet.addRow({
    metric: '--- By News Source ---',
    count: '',
    percentage: '',
  });
  Object.entries(stats.bySource).forEach(([src, cnt]) => {
    summarySheet.addRow({
      metric: src.toUpperCase(),
      count: cnt,
      percentage: pctStr(cnt),
    });
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

export function generateCsvReport(articles: NormalizedArticle[]): string {
  const headers = [
    'ID',
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

  const escapeCsv = (str: string | undefined | null) =>
    `"${(str || '').replace(/"/g, '""')}"`;

  const rows = articles.map((a) => [
    escapeCsv(a._id),
    escapeCsv(a.title),
    escapeCsv(a.source),
    escapeCsv(a.sentiment),
    escapeCsv(a.category),
    escapeCsv(a.assembly_segment),
    escapeCsv(a.location?.mandal || ''),
    escapeCsv(a.location?.village || ''),
    escapeCsv(a.created_on || a.first_seen_at || ''),
    escapeCsv(a.source_url),
    escapeCsv(
      a.summary ||
        (a as any).description ||
        (a as any).article_body ||
        (a as any).content ||
        '',
    ),
  ]);

  // Prepend UTF-8 BOM so Excel opens Telugu/Unicode seamlessly
  return (
    '\uFEFF' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\n')
  );
}
