import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

function escapePdf(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

function ascii(value: string): string {
  return value.replace(/[^\x09\x20-\x7E]/g, ' ').slice(0, 110);
}

/** A text PDF of the report. Telugu stays in the HTML email; the PDF keeps the English briefing. */
export function writeTextPdf(filePath: string, lines: string[]): void {
  const clean = lines.map(ascii);
  const pages: string[][] = [];
  for (let index = 0; index < clean.length; index += 42)
    pages.push(clean.slice(index, index + 42));
  if (!pages.length) pages.push(['MediaSphere Daily Report']);

  const objects = new Map<number, string>();
  objects.set(1, '<< /Type /Catalog /Pages 2 0 R >>');
  objects.set(3, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const pageIds: number[] = [];
  let nextId = 4;
  for (const page of pages) {
    const contentId = nextId;
    const pageId = nextId + 1;
    nextId += 2;
    pageIds.push(pageId);
    const commands = ['BT', '/F1 11 Tf', '16 TL', '50 800 Td'];
    page.forEach((line, lineIndex) => {
      commands.push(`(${escapePdf(line)}) Tj`);
      if (lineIndex < page.length - 1) commands.push('T*');
    });
    commands.push('ET');
    const body = commands.join('\n');
    objects.set(
      contentId,
      `<< /Length ${Buffer.byteLength(body)} >>\nstream\n${body}\nendstream`,
    );
    objects.set(
      pageId,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents ${contentId} 0 R /Resources << /Font << /F1 3 0 R >> >> >>`,
    );
  }
  objects.set(
    2,
    `<< /Type /Pages /Count ${pageIds.length} /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] >>`,
  );

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (let id = 1; id < nextId; id += 1) {
    offsets[id] = Buffer.byteLength(pdf);
    pdf += `${id} 0 obj\n${objects.get(id)}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${nextId}\n0000000000 65535 f \n`;
  for (let id = 1; id < nextId; id += 1)
    pdf += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer << /Size ${nextId} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, pdf);
}
