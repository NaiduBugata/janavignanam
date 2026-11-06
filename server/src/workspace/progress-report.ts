import ExcelJS from 'exceljs';
import type { Briefing } from './one-page-briefing';

export const STAGE_NAMES = [
  'Work started',
  'Inspection',
  'Work in progress',
  'Closing and handover',
] as const;
export type StageStatus = 'Pending' | 'In progress' | 'Completed';

export interface ProgressStage {
  name: string;
  status: StageStatus;
  note: string;
}

export interface ReportRow {
  title: string;
  detail: string;
  status: string;
  department: string;
  place: string;
  leader: string;
  officer?: string;
  action?: string;
  deadline?: string;
  remarks?: string;
  stages: ProgressStage[];
  updatedAt: string;
}

export function defaultStages(): ProgressStage[] {
  return STAGE_NAMES.map((name) => ({ name, status: 'Pending', note: '' }));
}

export function stageCounts(stages: ProgressStage[]): {
  completed: number;
  pending: number;
  active: number;
} {
  return {
    completed: stages.filter((stage) => stage.status === 'Completed').length,
    pending: stages.filter((stage) => stage.status === 'Pending').length,
    active: stages.filter((stage) => stage.status === 'In progress').length,
  };
}

export function reportLines(row: ReportRow): string[] {
  const counts = stageCounts(row.stages);
  const lines = [
    row.title || 'Report',
    '',
    `Status: ${row.status || 'Open'}`,
    `Department: ${row.department || 'General administration'}`,
    `Location: ${row.place || '—'}`,
    `Leader to contact: ${row.leader || '—'}`,
    `Progress: ${counts.completed} completed, ${counts.active} in progress, ${counts.pending} pending`,
    row.updatedAt ? `Last update: ${row.updatedAt}` : '',
    '',
    'Issue',
    row.detail || '—',
    '',
    'Stages',
  ];
  row.stages.forEach((stage, index) => {
    lines.push(`${index + 1}. ${stage.name} — ${stage.status}`);
    if (stage.note) lines.push(`   ${stage.note}`);
  });
  if (!row.stages.length) lines.push('No stages yet.');
  return lines.filter(
    (line, index, all) => line !== '' || all[index - 1] !== '',
  );
}

const GREEN: Rgb = [0.122, 0.302, 0.227];
const INK: Rgb = [0.11, 0.098, 0.082];
const MUTED: Rgb = [0.42, 0.384, 0.337];
const LINE: Rgb = [0.894, 0.863, 0.796];
const CREAM: Rgb = [0.973, 0.957, 0.925];
const PAPER: Rgb = [0.957, 0.945, 0.918];
const WHITE: Rgb = [1, 1, 1];
const AMBER: Rgb = [0.541, 0.353, 0];
const AMBER_BG: Rgb = [1, 0.957, 0.839];
const GREEN_BG: Rgb = [0.898, 0.949, 0.922];
const RED: Rgb = [0.62, 0.2, 0.16];
const BLUE: Rgb = [0.16, 0.38, 0.58];
const PAGE_W = 595;
const PAGE_H = 842;
const LEFT = 40;
const RIGHT = 555;

type Rgb = [number, number, number];

/** One grievance or project, laid out as a report rather than a plain text list. */
export function reportPdf(row: ReportRow): Buffer {
  return renderReports([row]);
}

/** Every saved report in a section, one designed page sequence each. */
export function combinedPdf(rows: ReportRow[]): Buffer {
  return renderReports(rows);
}

/** News problems, grievance progress, and MP benefits on one page when it fits. */
export function briefingPdf(data: Briefing): Buffer {
  const doc = new ReportDocument();
  doc.open();
  doc.briefingBanner('One page report', `Constituency briefing  ${data.generatedOn}`);
  doc.metrics([
    ['Problems collected', String(data.news.problemsCollected), AMBER],
    ['News articles', String(data.news.articles), GREEN],
    ['Grievances', String(data.grievances.total), BLUE],
    ['Not approved', String(data.grievances.notApproved), RED],
    ['Pending', String(data.grievances.pending), AMBER],
    ['In progress', String(data.grievances.inProgress), BLUE],
    ['Completed', String(data.grievances.completed), GREEN],
    ['People benefited', String(data.benefits.people), GREEN],
  ]);
  const gap = 10;
  const available = Math.max(360, doc.remaining() - gap * 2);
  const newsH = Math.round(available * 0.36);
  const grievanceH = Math.round(available * 0.38);
  const benefitH = available - newsH - grievanceH;
  doc.categoryBars(
    'Problems collected from news',
    data.news.byCategory,
    newsH,
  );
  doc.gap(gap);
  doc.grievanceTable('Grievances by category', data.grievances.byCategory, grievanceH);
  doc.gap(gap);
  doc.benefitGrid('People benefited by the MP', data.benefits.byKind, benefitH);
  return doc.toBuffer();
}

function renderReports(rows: ReportRow[]): Buffer {
  const doc = new ReportDocument();
  if (!rows.length) {
    doc.open();
    doc.banner('No reports saved yet', 'Constituency progress report');
    doc.paragraph('Reports', 'Nothing has been saved in this section yet.');
    return doc.toBuffer();
  }
  rows.forEach((row, index) => {
    if (index) doc.nextReport();
    else doc.open();
    paintReport(doc, row);
  });
  return doc.toBuffer();
}

function paintReport(doc: ReportDocument, row: ReportRow): void {
  const counts = stageCounts(row.stages);
  doc.banner(row.title || 'Report', 'Constituency progress report');
  const fields: Array<[string, string]> = [
    ['Status', row.status || 'Open'],
    ['Department', row.department || 'General administration'],
    ['Location', row.place || '—'],
    ['Leader to contact', row.leader || '—'],
  ];
  if (row.officer) fields.push(['Assigned officer', row.officer]);
  if (row.deadline) fields.push(['Deadline', formatWhen(row.deadline)]);
  if (row.remarks) fields.push(['Work update', row.remarks]);
  doc.fields(fields);
  doc.progress(counts);
  doc.paragraph('Issue', row.detail || '—');
  if (row.action) doc.paragraph('Action to be taken', row.action);
  doc.heading('Stages');
  if (!row.stages.length) doc.note('No stages recorded yet.');
  row.stages.forEach((stage, index) => doc.stage(index + 1, stage));
  if (row.updatedAt) doc.note(`Last update  ${formatWhen(row.updatedAt)}`);
}

class ReportDocument {
  private pages: string[][] = [];
  private ops: string[] = [];
  private y = PAGE_H;
  private title = 'Report';

  open(): void {
    this.ops = [];
    this.rect(0, 0, PAGE_W, PAGE_H, PAPER);
    this.y = PAGE_H;
  }

  nextReport(): void {
    this.footer();
    this.pages.push(this.ops);
    this.open();
  }

  banner(title: string, kicker: string): void {
    this.title = title || 'Report';
    const lines = clip(wrap(this.title, 18, RIGHT - LEFT, true), 3);
    const height = 78 + lines.length * 24;
    this.rect(0, PAGE_H - height, PAGE_W, height, GREEN);
    this.text(LEFT, PAGE_H - 28, 9, true, 'JANAVIGNANAM', [0.78, 0.88, 0.82]);
    this.text(LEFT, PAGE_H - 46, 10, false, kicker, [0.86, 0.92, 0.88]);
    lines.forEach((line, index) =>
      this.text(LEFT, PAGE_H - 76 - index * 24, 18, true, line, WHITE),
    );
    this.y = PAGE_H - height - 22;
  }

  briefingBanner(title: string, kicker: string): void {
    this.title = title || 'Report';
    const height = 48;
    this.rect(0, PAGE_H - height, PAGE_W, height, GREEN);
    this.text(LEFT, PAGE_H - 18, 8, true, 'JANAVIGNANAM', [0.78, 0.88, 0.82]);
    const when = kicker;
    this.text(RIGHT - widthOf(when, 8, false), PAGE_H - 18, 8, false, when, [0.86, 0.92, 0.88]);
    this.text(LEFT, PAGE_H - 38, 16, true, fit(title, 16, RIGHT - LEFT, true), WHITE);
    this.y = PAGE_H - height - 14;
  }

  remaining(): number {
    return this.y - 64;
  }

  gap(amount: number): void {
    this.y -= amount;
  }

  metrics(pairs: Array<[string, string, Rgb]>): void {
    const gap = 8;
    const columns = 4;
    const colW = (RIGHT - LEFT - gap * (columns - 1)) / columns;
    const rowH = 44;
    for (let index = 0; index < pairs.length; index += columns) {
      this.ensure(rowH + gap);
      pairs.slice(index, index + columns).forEach((pair, column) => {
        const x = LEFT + column * (colW + gap);
        const bottom = this.y - rowH;
        this.rect(x, bottom, colW, rowH, WHITE);
        this.stroke(x, bottom, colW, rowH, LINE);
        this.rect(x, bottom, 3, rowH, pair[2]);
        this.text(x + 12, bottom + 22, 15, true, fit(pair[1] || '0', 15, colW - 22, true), pair[2]);
        this.text(x + 12, bottom + 8, 7, true, fit(pair[0].toUpperCase(), 7, colW - 22, true), MUTED);
      });
      this.y -= rowH + gap;
    }
  }

  categoryBars(title: string, rows: Array<{ name: string; count: number }>, height: number): void {
    const box = this.panel(title, height);
    const items = rows.length ? rows : [{ name: 'No problem articles collected', count: 0 }];
    const max = Math.max(...items.map((row) => row.count), 1);
    const rowH = (box.bodyTop - box.bottom - 10) / items.length;
    const labelW = 118;
    const countW = 28;
    const barX = box.innerLeft + labelW;
    const barW = box.innerRight - countW - barX;
    items.forEach((row, index) => {
      const baseline = box.bodyTop - (index + 0.62) * rowH;
      this.text(box.innerLeft, baseline, 8, false, fit(row.name, 8, labelW - 8), INK);
      this.rect(barX, baseline - 1, Math.max(barW, 4), 6, CREAM);
      const filled = barW * (row.count / max);
      if (filled > 0) this.rect(barX, baseline - 1, Math.max(filled, 2), 6, GREEN);
      const count = String(row.count);
      this.text(box.innerRight - widthOf(count, 8, true), baseline, 8, true, count, INK);
    });
  }

  grievanceTable(
    title: string,
    rows: Array<{ name: string; count: number; pending: number; inProgress: number; completed: number; notApproved: number }>,
    height: number,
  ): void {
    const box = this.panel(title, height);
    const widths = [155, 54, 62, 74, 70, 74];
    const headers = ['Category', 'Total', 'Pending', 'In progress', 'Completed', 'Not approved'];
    const tones = [MUTED, INK, AMBER, BLUE, GREEN, RED];
    const headerY = box.bodyTop - 16;
    let x = box.innerLeft;
    headers.forEach((header, index) => {
      this.text(x, headerY, 7, true, header.toUpperCase(), MUTED);
      x += widths[index];
    });
    this.rect(box.innerLeft, headerY - 6, box.innerRight - box.innerLeft, 0.6, LINE);
    if (!rows.length) {
      this.text(box.innerLeft, headerY - 22, 8, false, 'No grievances saved yet.', MUTED);
      return;
    }
    const rowH = (headerY - 10 - box.bottom) / rows.length;
    rows.forEach((row, index) => {
      const baseline = headerY - 8 - (index + 0.72) * rowH;
      const values = [row.name, String(row.count), String(row.pending), String(row.inProgress), String(row.completed), String(row.notApproved)];
      let cell = box.innerLeft;
      values.forEach((value, column) => {
        const bold = column > 0;
        this.text(cell, baseline, 8, bold, fit(value, 8, widths[column] - 8, bold), column === 0 ? INK : tones[column]);
        cell += widths[column];
      });
    });
  }

  benefitGrid(title: string, rows: Array<{ name: string; count: number }>, height: number): void {
    const box = this.panel(title, height);
    const items = rows.length ? rows : [{ name: 'No benefits recorded', count: 0 }];
    const columns = 2;
    const gap = 8;
    const colW = (box.innerRight - box.innerLeft - gap) / columns;
    const rowsHigh = Math.ceil(items.length / columns);
    const rowH = Math.min(28, (box.bodyTop - box.bottom - 28) / rowsHigh);
    items.forEach((row, index) => {
      const column = index % columns;
      const line = Math.floor(index / columns);
      const x = box.innerLeft + column * (colW + gap);
      const bottom = box.bodyTop - (line + 1) * rowH;
      this.rect(x, bottom + 4, colW, rowH - 6, row.count > 0 ? GREEN_BG : CREAM);
      this.text(x + 8, bottom + 10, 8, false, fit(row.name, 8, colW - 36), INK);
      const count = String(row.count);
      this.text(x + colW - 8 - widthOf(count, 9, true), bottom + 10, 9, true, count, row.count > 0 ? GREEN : MUTED);
    });
    this.text(
      box.innerLeft,
      box.bottom + 8,
      7,
      false,
      'Completed grievances are the problems solved. News counts are problems collected from articles.',
      MUTED,
    );
  }

  fields(pairs: Array<[string, string]>): void {
    const gap = 12;
    const colW = (RIGHT - LEFT - gap) / 2;
    const rowH = 52;
    for (let index = 0; index < pairs.length; index += 2) {
      this.ensure(rowH + 10);
      pairs.slice(index, index + 2).forEach((pair, column) => {
        const x = LEFT + column * (colW + gap);
        const bottom = this.y - rowH;
        this.rect(x, bottom, colW, rowH, WHITE);
        this.stroke(x, bottom, colW, rowH, LINE);
        this.text(x + 12, bottom + 32, 8, true, pair[0].toUpperCase(), MUTED);
        this.text(
          x + 12,
          bottom + 14,
          11,
          true,
          wrap(pair[1] || '—', 11, colW - 24, true)[0] || '—',
          INK,
        );
      });
      this.y -= rowH + 10;
    }
  }

  progress(counts: {
    completed: number;
    pending: number;
    active: number;
  }): void {
    this.ensure(78);
    const total = Math.max(
      counts.completed + counts.active + counts.pending,
      1,
    );
    this.text(LEFT, this.y - 2, 13, true, 'Work progress', INK);
    const summary = `${counts.completed} of ${total} complete`;
    this.text(
      RIGHT - widthOf(summary, 9, true),
      this.y - 2,
      9,
      true,
      summary,
      MUTED,
    );
    this.y -= 18;
    const barW = RIGHT - LEFT;
    this.rect(LEFT, this.y - 8, barW, 8, LINE);
    const doneW = barW * (counts.completed / total);
    const activeW = barW * (counts.active / total);
    if (doneW > 0) this.rect(LEFT, this.y - 8, Math.max(doneW, 6), 8, GREEN);
    if (activeW > 0)
      this.rect(LEFT + doneW, this.y - 8, Math.max(activeW, 6), 8, AMBER);
    this.y -= 26;
    this.text(
      LEFT,
      this.y,
      9,
      false,
      `${counts.completed} completed  |  ${counts.active} in progress  |  ${counts.pending} pending`,
      MUTED,
    );
    this.y -= 26;
  }

  paragraph(title: string, body: string): void {
    this.heading(title);
    const lines = wrap(body || '—', 11, RIGHT - LEFT - 28);
    const shown = lines.length ? lines : ['—'];
    let start = 0;
    while (start < shown.length) {
      this.ensure(48);
      const room = Math.max(1, Math.floor((this.y - 78) / 16));
      const chunk = shown.slice(start, start + room);
      const boxH = 16 + chunk.length * 16;
      const bottom = this.y - boxH;
      this.rect(LEFT, bottom, RIGHT - LEFT, boxH, WHITE);
      this.stroke(LEFT, bottom, RIGHT - LEFT, boxH, LINE);
      chunk.forEach((line, index) =>
        this.text(
          LEFT + 14,
          bottom + boxH - 20 - index * 16,
          11,
          false,
          line,
          INK,
        ),
      );
      this.y = bottom - 14;
      start += chunk.length;
    }
  }

  heading(value: string): void {
    this.ensure(28);
    this.text(LEFT, this.y - 4, 13, true, value, INK);
    this.y -= 22;
  }

  stage(index: number, stage: ProgressStage): void {
    const noteLines = stage.note ? wrap(stage.note, 9, RIGHT - LEFT - 130) : [];
    const boxH = 34 + noteLines.length * 13;
    this.ensure(boxH + 8);
    const bottom = this.y - boxH;
    this.rect(LEFT, bottom, RIGHT - LEFT, boxH, WHITE);
    this.stroke(LEFT, bottom, RIGHT - LEFT, boxH, LINE);
    this.rect(LEFT, bottom, 4, boxH, stageTone(stage.status).bar);
    this.text(LEFT + 16, bottom + boxH - 22, 11, true, String(index), GREEN);
    this.text(
      LEFT + 36,
      bottom + boxH - 22,
      11,
      true,
      wrap(stage.name, 11, 320, true)[0] || 'Stage',
      INK,
    );
    const label = stage.status;
    const pillW = widthOf(label, 8, true) + 16;
    const pillX = RIGHT - 14 - pillW;
    const pillY = bottom + boxH - 26;
    this.rect(pillX, pillY, pillW, 16, stageTone(stage.status).bg);
    this.text(
      pillX + 8,
      pillY + 4,
      8,
      true,
      label,
      stageTone(stage.status).ink,
    );
    noteLines.forEach((line, lineIndex) =>
      this.text(
        LEFT + 36,
        bottom + boxH - 40 - lineIndex * 13,
        9,
        false,
        line,
        MUTED,
      ),
    );
    this.y = bottom - 8;
  }

  note(value: string): void {
    this.ensure(18);
    this.text(LEFT, this.y - 10, 8, false, value, MUTED);
    this.y -= 18;
  }

  private panel(title: string, height: number): {
    bottom: number;
    bodyTop: number;
    innerLeft: number;
    innerRight: number;
  } {
    this.ensure(height);
    const top = this.y;
    const bottom = top - height;
    this.rect(LEFT, bottom, RIGHT - LEFT, height, WHITE);
    this.stroke(LEFT, bottom, RIGHT - LEFT, height, LINE);
    this.rect(LEFT, top - 22, RIGHT - LEFT, 22, CREAM);
    this.rect(LEFT, bottom, 3, height, GREEN);
    this.text(LEFT + 14, top - 15, 10, true, title, INK);
    this.y = bottom;
    return {
      bottom: bottom + 8,
      bodyTop: top - 28,
      innerLeft: LEFT + 14,
      innerRight: RIGHT - 12,
    };
  }

  toBuffer(): Buffer {
    this.footer();
    this.pages.push(this.ops);
    const total = this.pages.length;
    this.pages.forEach((ops, index) => {
      const label = `Page ${index + 1} of ${total}`;
      ops.push(
        textOp(RIGHT - widthOf(label, 8, false), 28, 8, false, label, MUTED),
      );
    });
    return compilePdf(this.pages.map((ops) => ops.join('\n')));
  }

  private ensure(height: number): void {
    if (this.y - height >= 64) return;
    this.footer();
    this.pages.push(this.ops);
    this.ops = [];
    this.rect(0, 0, PAGE_W, PAGE_H, PAPER);
    this.rect(0, PAGE_H - 58, PAGE_W, 58, GREEN);
    this.text(LEFT, PAGE_H - 22, 8, true, 'JANAVIGNANAM', [0.78, 0.88, 0.82]);
    this.text(
      LEFT,
      PAGE_H - 40,
      11,
      true,
      wrap(this.title, 11, RIGHT - LEFT, true)[0] || 'Report',
      WHITE,
    );
    this.y = PAGE_H - 80;
  }

  private footer(): void {
    this.rect(LEFT, 46, RIGHT - LEFT, 0.6, LINE);
    this.text(LEFT, 28, 8, false, 'JanaVignanam', MUTED);
  }

  private rect(x: number, y: number, w: number, h: number, color: Rgb): void {
    this.ops.push(`${rgb(color)} ${num(x)} ${num(y)} ${num(w)} ${num(h)} re f`);
  }

  private stroke(x: number, y: number, w: number, h: number, color: Rgb): void {
    this.ops.push(
      `${rgb(color).replace(' rg', ' RG')} 0.6 w ${num(x)} ${num(y)} ${num(w)} ${num(h)} re S`,
    );
  }

  private text(
    x: number,
    y: number,
    size: number,
    bold: boolean,
    value: string,
    color: Rgb,
  ): void {
    this.ops.push(textOp(x, y, size, bold, value, color));
  }
}

function stageTone(status: StageStatus): { bg: Rgb; ink: Rgb; bar: Rgb } {
  if (status === 'Completed') return { bg: GREEN_BG, ink: GREEN, bar: GREEN };
  if (status === 'In progress') return { bg: AMBER_BG, ink: AMBER, bar: AMBER };
  return { bg: CREAM, ink: MUTED, bar: LINE };
}

function textOp(
  x: number,
  y: number,
  size: number,
  bold: boolean,
  value: string,
  color: Rgb,
): string {
  return `BT ${rgb(color)} /${bold ? 'F2' : 'F1'} ${size} Tf 1 0 0 1 ${num(x)} ${num(y)} Tm (${pdfText(latin(value))}) Tj ET`;
}

function compilePdf(pages: string[]): Buffer {
  const objects: string[] = [
    '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n',
    `2 0 obj << /Type /Pages /Kids [${pages.map((_, index) => `${3 + index * 2} 0 R`).join(' ')}] /Count ${pages.length} >> endobj\n`,
  ];
  const regular = 3 + pages.length * 2;
  const bold = regular + 1;
  pages.forEach((stream, index) => {
    const pageId = 3 + index * 2;
    const contentId = pageId + 1;
    objects.push(
      `${pageId} 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Contents ${contentId} 0 R /Resources << /Font << /F1 ${regular} 0 R /F2 ${bold} 0 R >> >> >> endobj\n`,
    );
    objects.push(
      `${contentId} 0 obj << /Length ${Buffer.byteLength(stream)} >> stream\n${stream}\nendstream endobj\n`,
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
  for (let index = 1; index < offsets.length; index += 1)
    xref += `${String(offsets[index]).padStart(10, '0')} 00000 n \n`;
  body += `${xref}trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF`;
  return Buffer.from(body);
}

function formatWhen(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split('-').map(Number);
    return new Date(year, month - 1, day).toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'Asia/Kolkata',
  });
}

export async function recordsWorkbook(rows: ReportRow[]): Promise<Buffer> {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet('Reports');
  sheet.columns = [
    { header: 'Title', key: 'title', width: 32 },
    { header: 'Department', key: 'department', width: 28 },
    { header: 'Location', key: 'place', width: 24 },
    { header: 'Leader', key: 'leader', width: 22 },
    { header: 'Status', key: 'status', width: 16 },
    { header: 'Work update', key: 'remarks', width: 28 },
    { header: 'Completed', key: 'completed', width: 14 },
    { header: 'In progress', key: 'active', width: 14 },
    { header: 'Pending', key: 'pending', width: 12 },
    { header: 'Issue', key: 'detail', width: 48 },
    { header: 'Stages', key: 'stages', width: 48 },
    { header: 'Last update', key: 'updatedAt', width: 24 },
  ];
  sheet.getRow(1).font = { bold: true };
  for (const row of rows) {
    const counts = stageCounts(row.stages);
    sheet.addRow({
      title: row.title,
      department: row.department,
      place: row.place,
      leader: row.leader,
      status: row.status,
      remarks: row.remarks || '',
      completed: counts.completed,
      active: counts.active,
      pending: counts.pending,
      detail: row.detail,
      stages: row.stages
        .map(
          (stage) =>
            `${stage.name}: ${stage.status}${stage.note ? ` (${stage.note})` : ''}`,
        )
        .join('; '),
      updatedAt: row.updatedAt,
    });
  }
  const data = await book.xlsx.writeBuffer();
  return Buffer.from(data);
}

function latin(value: string): string {
  return value
    .replace(/[^\x09\x20-\x7E]/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function rgb(color: Rgb): string {
  return `${color.map((channel) => channel.toFixed(3)).join(' ')} rg`;
}

function num(value: number): string {
  return (Math.round(value * 100) / 100).toString();
}

function widthOf(value: string, size: number, bold: boolean): number {
  return latin(value).length * size * (bold ? 0.52 : 0.48);
}

function wrap(
  value: string,
  size: number,
  maxWidth: number,
  bold = false,
): string[] {
  const words = latin(value).split(' ').filter(Boolean);
  if (!words.length) return [];
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const piece = word.length > 60 ? word.slice(0, 60) : word;
    const next = current ? `${current} ${piece}` : piece;
    if (current && widthOf(next, size, bold) > maxWidth) {
      lines.push(current);
      current = piece;
    } else current = next;
  }
  if (current) lines.push(current);
  return lines;
}

function fit(value: string, size: number, maxWidth: number, bold = false): string {
  const text = latin(value);
  if (widthOf(text, size, bold) <= maxWidth) return text;
  let cut = text;
  while (cut.length > 1 && widthOf(`${cut}...`, size, bold) > maxWidth) cut = cut.slice(0, -1);
  return `${cut}...`;
}

function clip(lines: string[], max: number): string[] {
  if (lines.length <= max) return lines;
  const kept = lines.slice(0, max);
  const last = kept[max - 1];
  kept[max - 1] =
    last.length > 3 ? `${last.slice(0, last.length - 3)}...` : `${last}...`;
  return kept;
}

function pdfText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}
