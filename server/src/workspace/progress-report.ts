import ExcelJS from 'exceljs';

export const STAGE_NAMES = ['Work started', 'Inspection', 'Work in progress', 'Closing and handover'] as const;
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
  stages: ProgressStage[];
  updatedAt: string;
}

export function defaultStages(): ProgressStage[] {
  return STAGE_NAMES.map((name) => ({ name, status: 'Pending', note: '' }));
}

export function stageCounts(stages: ProgressStage[]): { completed: number; pending: number; active: number } {
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
  return lines.filter((line, index, all) => line !== '' || all[index - 1] !== '');
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
    lines.forEach((line, index) => this.text(LEFT, PAGE_H - 76 - index * 24, 18, true, line, WHITE));
    this.y = PAGE_H - height - 22;
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
        this.text(x + 12, bottom + 14, 11, true, wrap(pair[1] || '—', 11, colW - 24, true)[0] || '—', INK);
      });
      this.y -= rowH + 10;
    }
  }

  progress(counts: { completed: number; pending: number; active: number }): void {
    this.ensure(78);
    const total = Math.max(counts.completed + counts.active + counts.pending, 1);
    this.text(LEFT, this.y - 2, 13, true, 'Work progress', INK);
    const summary = `${counts.completed} of ${total} complete`;
    this.text(RIGHT - widthOf(summary, 9, true), this.y - 2, 9, true, summary, MUTED);
    this.y -= 18;
    const barW = RIGHT - LEFT;
    this.rect(LEFT, this.y - 8, barW, 8, LINE);
    const doneW = barW * (counts.completed / total);
    const activeW = barW * (counts.active / total);
    if (doneW > 0) this.rect(LEFT, this.y - 8, Math.max(doneW, 6), 8, GREEN);
    if (activeW > 0) this.rect(LEFT + doneW, this.y - 8, Math.max(activeW, 6), 8, AMBER);
    this.y -= 26;
    this.text(LEFT, this.y, 9, false, `${counts.completed} completed  |  ${counts.active} in progress  |  ${counts.pending} pending`, MUTED);
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
      chunk.forEach((line, index) => this.text(LEFT + 14, bottom + boxH - 20 - index * 16, 11, false, line, INK));
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
    this.text(LEFT + 36, bottom + boxH - 22, 11, true, wrap(stage.name, 11, 320, true)[0] || 'Stage', INK);
    const label = stage.status;
    const pillW = widthOf(label, 8, true) + 16;
    const pillX = RIGHT - 14 - pillW;
    const pillY = bottom + boxH - 26;
    this.rect(pillX, pillY, pillW, 16, stageTone(stage.status).bg);
    this.text(pillX + 8, pillY + 4, 8, true, label, stageTone(stage.status).ink);
    noteLines.forEach((line, lineIndex) => this.text(LEFT + 36, bottom + boxH - 40 - lineIndex * 13, 9, false, line, MUTED));
    this.y = bottom - 8;
  }

  note(value: string): void {
    this.ensure(18);
    this.text(LEFT, this.y - 10, 8, false, value, MUTED);
    this.y -= 18;
  }

  toBuffer(): Buffer {
    this.footer();
    this.pages.push(this.ops);
    const total = this.pages.length;
    this.pages.forEach((ops, index) => {
      const label = `Page ${index + 1} of ${total}`;
      ops.push(textOp(RIGHT - widthOf(label, 8, false), 28, 8, false, label, MUTED));
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
    this.text(LEFT, PAGE_H - 40, 11, true, wrap(this.title, 11, RIGHT - LEFT, true)[0] || 'Report', WHITE);
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
    this.ops.push(`${rgb(color).replace(' rg', ' RG')} 0.6 w ${num(x)} ${num(y)} ${num(w)} ${num(h)} re S`);
  }

  private text(x: number, y: number, size: number, bold: boolean, value: string, color: Rgb): void {
    this.ops.push(textOp(x, y, size, bold, value, color));
  }
}

function stageTone(status: StageStatus): { bg: Rgb; ink: Rgb; bar: Rgb } {
  if (status === 'Completed') return { bg: GREEN_BG, ink: GREEN, bar: GREEN };
  if (status === 'In progress') return { bg: AMBER_BG, ink: AMBER, bar: AMBER };
  return { bg: CREAM, ink: MUTED, bar: LINE };
}

function textOp(x: number, y: number, size: number, bold: boolean, value: string, color: Rgb): string {
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
    objects.push(`${pageId} 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Contents ${contentId} 0 R /Resources << /Font << /F1 ${regular} 0 R /F2 ${bold} 0 R >> >> >> endobj\n`);
    objects.push(`${contentId} 0 obj << /Length ${Buffer.byteLength(stream)} >> stream\n${stream}\nendstream endobj\n`);
  });
  objects.push(`${regular} 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\n`);
  objects.push(`${bold} 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >> endobj\n`);
  let body = '%PDF-1.4\n';
  const offsets = [0];
  for (const object of objects) {
    offsets.push(Buffer.byteLength(body));
    body += object;
  }
  const xrefAt = Buffer.byteLength(body);
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let index = 1; index < offsets.length; index += 1) xref += `${String(offsets[index]).padStart(10, '0')} 00000 n \n`;
  body += `${xref}trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF`;
  return Buffer.from(body);
}

function formatWhen(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split('-').map(Number);
    return new Date(year, month - 1, day).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' });
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
      completed: counts.completed,
      active: counts.active,
      pending: counts.pending,
      detail: row.detail,
      stages: row.stages.map((stage) => `${stage.name}: ${stage.status}${stage.note ? ` (${stage.note})` : ''}`).join('; '),
      updatedAt: row.updatedAt,
    });
  }
  const data = await book.xlsx.writeBuffer();
  return Buffer.from(data);
}

function latin(value: string): string {
  return value.replace(/[^\x09\x20-\x7E]/g, ' ').replace(/[ \t]+/g, ' ').trim();
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

function wrap(value: string, size: number, maxWidth: number, bold = false): string[] {
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

function clip(lines: string[], max: number): string[] {
  if (lines.length <= max) return lines;
  const kept = lines.slice(0, max);
  const last = kept[max - 1];
  kept[max - 1] = last.length > 3 ? `${last.slice(0, last.length - 3)}...` : `${last}...`;
  return kept;
}

function pdfText(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}
