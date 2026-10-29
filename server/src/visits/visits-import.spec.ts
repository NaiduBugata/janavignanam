import { execFileSync } from 'node:child_process';
import path from 'node:path';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import {
  TEMPLATE_HEADERS,
  formatVisitTime,
  gridFromPdfItems,
  headerColumns,
  parseVisitDate,
  parseVisitTime,
  readVisitRows,
  rowsFromGrids,
} from './visits-import';
import { excelTemplate, wordTemplate } from './visits-template';

async function excelFile(
  rows: unknown[][],
  sheetName = 'Visits',
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(sheetName);
  rows.forEach((row) => sheet.addRow(row));
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

async function wordFile(
  tables: string[][][],
  before = 'Visits list',
): Promise<Buffer> {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const cell = (text: string) =>
    `<w:tc><w:p>${text
      .split('\n')
      .map(
        (line, i) =>
          `${i ? '<w:br/>' : ''}<w:r><w:t xml:space="preserve">${esc(line)}</w:t></w:r>`,
      )
      .join('')}</w:p></w:tc>`;
  const body = tables
    .map(
      (rows) =>
        `<w:tbl>${rows.map((cells) => `<w:tr>${cells.map(cell).join('')}</w:tr>`).join('')}</w:tbl>`,
    )
    .join('<w:p/>');
  const zip = new JSZip();
  zip.file(
    'word/document.xml',
    `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${before}</w:t></w:r></w:p>${body}</w:body></w:document>`,
  );
  return zip.generateAsync({ type: 'nodebuffer' });
}

/** Tiny PDF writer: each row is drawn at fixed column positions, optionally with ruled cell borders. */
function pdfFile(rows: string[][], ruled: boolean): Buffer {
  const xs = [40, 90, 170, 250, 350, 540, 800];
  const top = 540;
  const height = 24;
  const esc = (s: string) =>
    s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  let content = '';
  rows.forEach((cells, r) => {
    const y = top - r * height;
    cells.forEach((text, c) => {
      if (text)
        content += `BT /F1 9 Tf ${xs[c] + 4} ${y - 16} Td (${esc(text)}) Tj ET\n`;
    });
  });
  if (ruled) {
    content += '0.5 w\n';
    for (let r = 0; r <= rows.length; r++)
      content += `${xs[0]} ${top - r * height} m ${xs[xs.length - 1]} ${top - r * height} l S\n`;
    for (const x of xs)
      content += `${x} ${top} m ${x} ${top - rows.length * height} l S\n`;
  }
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 842 595] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}endstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out, 'latin1'));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

/**
 * pdf.js is ESM-only and Jest's CommonJS sandbox cannot import it, so real PDFs are read by
 * the same module in a plain Node child process.
 */
function readPdfInNode(pdf: Buffer): {
  rows?: Array<Record<string, string>>;
  rejected?: unknown[];
  error?: string;
} {
  const script = `
    const { readVisitRows } = require(${JSON.stringify(path.join(__dirname, 'visits-import'))});
    readVisitRows('pdf', 'pdf', Buffer.from(process.env.VISITS_PDF_B64, 'base64')).then(
      (result) => process.stdout.write(JSON.stringify(result)),
      (err) => process.stdout.write(JSON.stringify({ error: err.message })),
    );`;
  const out = execFileSync(
    process.execPath,
    ['-r', 'ts-node/register/transpile-only', '-e', script],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        VISITS_PDF_B64: pdf.toString('base64'),
        TS_NODE_PROJECT: path.join(__dirname, '..', '..', 'tsconfig.spec.json'),
      },
    },
  );
  return JSON.parse(out);
}

const HEADER = ['S.No', 'Date', 'Time', 'Place', 'Purpose', 'Details'];
const PDF_ROWS = [
  HEADER,
  [
    '1',
    '12-09-2026',
    '10:30 AM',
    'Macherla',
    'Road inspection',
    'Checked the bypass works',
  ],
  [
    '2',
    '15/09/2026',
    '',
    'Gurazala',
    'Farmers meeting',
    'Heard crop loss complaints',
  ],
];

describe('parseVisitDate', () => {
  it('reads Indian day-first dates, ISO dates, month names, and Excel serial numbers', () => {
    expect(parseVisitDate('28-09-2026')).toBe('2026-09-28');
    expect(parseVisitDate('5/10/2026')).toBe('2026-10-05');
    expect(parseVisitDate('05.10.26')).toBe('2026-10-05');
    expect(parseVisitDate('2026-09-28')).toBe('2026-09-28');
    expect(parseVisitDate('28 Sep 2026')).toBe('2026-09-28');
    expect(parseVisitDate('28th September, 2026')).toBe('2026-09-28');
    expect(parseVisitDate('Sept 28, 2026')).toBe('2026-09-28');
    expect(parseVisitDate('46293')).toBe('2026-09-28');
    expect(parseVisitDate('  ')).toBe('');
  });

  it('refuses text and impossible dates', () => {
    expect(parseVisitDate('next week')).toBeNull();
    expect(parseVisitDate('31-02-2026')).toBeNull();
    expect(parseVisitDate('12-13-2026')).toBeNull();
  });
});

describe('parseVisitTime', () => {
  it('reads 12-hour and 24-hour times, Telugu day parts, Excel fractions, and ranges', () => {
    expect(parseVisitTime('10:30 AM')).toBe('10:30');
    expect(parseVisitTime('10.30am')).toBe('10:30');
    expect(parseVisitTime('2 PM')).toBe('14:00');
    expect(parseVisitTime('12:15 a.m.')).toBe('00:15');
    expect(parseVisitTime('12 PM')).toBe('12:00');
    expect(parseVisitTime('14:30')).toBe('14:30');
    expect(parseVisitTime('09:05:00')).toBe('09:05');
    expect(parseVisitTime('ఉదయం 10:30')).toBe('10:30');
    expect(parseVisitTime('సాయంత్రం 5 గంటలకు')).toBe('17:00');
    expect(parseVisitTime('0.4375')).toBe('10:30');
    expect(parseVisitTime('10 AM - 12:30 PM')).toBe('10:00-12:30');
    expect(parseVisitTime('10 - 11 AM')).toBe('10:00-11:00');
    expect(parseVisitTime('11:00 to 13:00')).toBe('11:00-13:00');
    expect(parseVisitTime(' ')).toBe('');
  });

  it('refuses text, bare numbers, and impossible times', () => {
    expect(parseVisitTime('morning')).toBeNull();
    expect(parseVisitTime('10')).toBeNull();
    expect(parseVisitTime('25:00')).toBeNull();
    expect(parseVisitTime('10:75')).toBeNull();
    expect(parseVisitTime('13 PM')).toBeNull();
  });

  it('formats stored times for people', () => {
    expect(formatVisitTime('10:30')).toBe('10:30 AM');
    expect(formatVisitTime('00:15')).toBe('12:15 AM');
    expect(formatVisitTime('10:00-12:30')).toBe('10:00 AM – 12:30 PM');
    expect(formatVisitTime('')).toBe('');
  });
});

describe('headerColumns', () => {
  it('matches English and Telugu headers and ignores the serial column', () => {
    expect(headerColumns(TEMPLATE_HEADERS)).toEqual({
      date: 1,
      time: 2,
      place: 3,
      title: 4,
      detail: 5,
      phone: 6,
    });
    expect(
      headerColumns([
        'S.No',
        'Date (DD-MM-YYYY)',
        'Place',
        'Purpose / Title',
        'Details',
      ]),
    ).toEqual({
      date: 1,
      place: 2,
      title: 3,
      detail: 4,
    });
    expect(
      headerColumns([
        'క్రమ సంఖ్య',
        'తేదీ',
        'సమయం',
        'గ్రామం',
        'కార్యక్రమం',
        'వివరాలు',
      ]),
    ).toEqual({
      date: 1,
      time: 2,
      place: 3,
      title: 4,
      detail: 5,
    });
    expect(
      headerColumns(['Visit date', 'Place of visit', 'Visit details']),
    ).toEqual({ date: 0, place: 1, detail: 2 });
  });

  it('does not treat a data row as a header', () => {
    expect(
      headerColumns([
        '1',
        '28-09-2026',
        'Vinukonda',
        'Hospital visit',
        'Met staff',
      ]),
    ).toBeNull();
    expect(
      headerColumns(['', '', '11:00', 'Place visit', 'Timing details']),
    ).toBeNull();
    expect(headerColumns(['Date', 'Remarks'])).toBeNull();
  });

  it('imports data rows whose cells use header words such as time, visit, or details', () => {
    const { rows } = rowsFromGrids([
      {
        label: (index) => `Row ${index + 1}`,
        rows: [
          ['S.No', 'Date', 'Time', 'Place', 'Purpose', 'Details'],
          [
            '1',
            '20-09-2026',
            '11:00',
            'Vinukonda',
            'Hospital visit',
            'Real time check of the ward',
          ],
          [
            '',
            '',
            '',
            'Macherla',
            'Visit timing review',
            'Place and date details to follow',
          ],
          ['S.No', 'Date', 'Time', 'Place', 'Purpose', 'Details'],
        ],
      },
    ]);
    expect(rows.map((row) => [row.where, row.place, row.visitTime])).toEqual([
      ['Row 2', 'Vinukonda', '11:00'],
      ['Row 3', 'Macherla', ''],
    ]);
  });
});

describe('readVisitRows', () => {
  it('reads an Excel sheet: real date cells, typed dates, place-only rows, and bad dates', async () => {
    const buffer = await excelFile([
      ['Monthly visits'],
      ['S.No', 'Date', 'Place', 'Purpose / Title', 'Details'],
      [
        1,
        new Date(Date.UTC(2026, 8, 28)),
        'Vinukonda',
        'Hospital visit',
        'Met the staff',
      ],
      [2, '02-10-2026', 'Macherla', '', 'Gandhi Jayanti programme'],
      [3, 'someday', 'Gurazala', 'Farmers meet', ''],
      [4, '', '', '', ''],
      [5, '', 'Chilakaluripet', 'Temple festival', ''],
    ]);
    const { rows, rejected } = await readVisitRows('excel', 'xlsx', buffer);
    expect(rows).toEqual([
      {
        where: 'Row 3',
        title: 'Hospital visit',
        place: 'Vinukonda',
        visitDate: '2026-09-28',
        visitTime: '',
        detail: 'Met the staff',
        leadPhone: '',
      },
      {
        where: 'Row 4',
        title: 'Visit to Macherla',
        place: 'Macherla',
        visitDate: '2026-10-02',
        visitTime: '',
        detail: 'Gandhi Jayanti programme',
        leadPhone: '',
      },
      {
        where: 'Row 7',
        title: 'Temple festival',
        place: 'Chilakaluripet',
        visitDate: '',
        visitTime: '',
        detail: '',
        leadPhone: '',
      },
    ]);
    expect(rejected).toEqual([
      {
        where: 'Row 5',
        reason: 'Date "someday" is not a date like 28-09-2026.',
      },
    ]);
  });

  it('reads times from a Time column, from Excel time cells, and from date-time cells', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Visits');
    sheet.addRow(['S.No', 'Date', 'Time', 'Place', 'Purpose']);
    sheet.addRow([
      1,
      '28-09-2026',
      new Date(Date.UTC(1899, 11, 30, 15, 45)),
      'Vinukonda',
      'Hospital visit',
    ]);
    sheet.getCell('C2').numFmt = 'h:mm AM/PM';
    sheet.addRow([
      2,
      '29-09-2026',
      '10 AM - 12:30 PM',
      'Macherla',
      'Review meeting',
    ]);
    sheet.addRow([
      3,
      new Date(Date.UTC(2026, 8, 30, 9, 15)),
      '',
      'Gurazala',
      'Farmers meet',
    ]);
    sheet.getCell('B4').numFmt = 'dd-mm-yyyy hh:mm';
    sheet.addRow([4, '01-10-2026 6:00 PM', '', 'Ipur', 'Village meeting']);
    sheet.addRow([5, '02-10-2026', 'evening', 'Bollapalli', 'Temple visit']);
    const { rows, rejected } = await readVisitRows(
      'excel',
      'xlsx',
      Buffer.from(await workbook.xlsx.writeBuffer()),
    );
    expect(
      rows.map(({ visitDate, visitTime, place }) => [
        visitDate,
        visitTime,
        place,
      ]),
    ).toEqual([
      ['2026-09-28', '15:45', 'Vinukonda'],
      ['2026-09-29', '10:00-12:30', 'Macherla'],
      ['2026-09-30', '09:15', 'Gurazala'],
      ['2026-10-01', '18:00', 'Ipur'],
    ]);
    expect(rejected).toEqual([
      { where: 'Row 6', reason: 'Time "evening" is not a time like 10:30 AM.' },
    ]);
  });

  it('reads the downloaded templates without importing the example row', async () => {
    await expect(
      readVisitRows('excel', 'xlsx', await excelTemplate()),
    ).resolves.toEqual({ rows: [], rejected: [] });
    await expect(
      readVisitRows('word', 'docx', await wordTemplate()),
    ).resolves.toEqual({ rows: [], rejected: [] });
  });

  it('reads a filled Excel template', async () => {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load((await excelTemplate()) as unknown as ArrayBuffer);
    const sheet = workbook.getWorksheet('Visits')!;
    sheet.spliceRows(2, 1);
    sheet.addRow([
      1,
      new Date(Date.UTC(2026, 8, 20)),
      new Date(Date.UTC(1899, 11, 30, 11, 0)),
      'Pedakurapadu',
      'School visit',
      'Mid-day meal check',
    ]);
    sheet.addRow([2, '21-09-2026', '4:30 PM', 'Ipur', 'Ward meeting', '']);
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    const { rows } = await readVisitRows('excel', 'xlsx', buffer);
    expect(rows).toEqual([
      {
        where: 'Row 2',
        title: 'School visit',
        place: 'Pedakurapadu',
        visitDate: '2026-09-20',
        visitTime: '11:00',
        detail: 'Mid-day meal check',
        leadPhone: '',
      },
      {
        where: 'Row 3',
        title: 'Ward meeting',
        place: 'Ipur',
        visitDate: '2026-09-21',
        visitTime: '16:30',
        detail: '',
        leadPhone: '',
      },
    ]);
  });

  it('reads Word tables, keeps line breaks in details, and uses Telugu headers', async () => {
    const buffer = await wordFile([
      [
        ['క్రమ సంఖ్య', 'తేదీ', 'సమయం', 'గ్రామం', 'కార్యక్రమం', 'వివరాలు'],
        [
          '1',
          '28-09-2026',
          'ఉదయం 11:00',
          'నరసరావుపేట',
          'ఆసుపత్రి సందర్శన',
          'కొత్త వార్డు\nసిబ్బందితో సమావేశం',
        ],
        ['2', '', '', '', '', ''],
      ],
    ]);
    const { rows } = await readVisitRows('word', 'docx', buffer);
    expect(rows).toEqual([
      {
        where: 'Row 2',
        title: 'ఆసుపత్రి సందర్శన',
        place: 'నరసరావుపేట',
        visitDate: '2026-09-28',
        visitTime: '11:00',
        detail: 'కొత్త వార్డు\nసిబ్బందితో సమావేశం',
        leadPhone: '',
      },
    ]);
  });

  it('reads real PDF files with pdf.js, with and without table borders', () => {
    const expected = [
      {
        where: 'Page 1, row 1',
        title: 'Road inspection',
        place: 'Macherla',
        visitDate: '2026-09-12',
        visitTime: '10:30',
        detail: 'Checked the bypass works',
        leadPhone: '',
      },
      {
        where: 'Page 1, row 2',
        title: 'Farmers meeting',
        place: 'Gurazala',
        visitDate: '2026-09-15',
        visitTime: '',
        detail: 'Heard crop loss complaints',
        leadPhone: '',
      },
    ];
    expect(readPdfInNode(pdfFile(PDF_ROWS, true))).toEqual({
      rows: expected,
      rejected: [],
    });
    expect(readPdfInNode(pdfFile(PDF_ROWS, false))).toEqual({
      rows: expected,
      rejected: [],
    });
    expect(readPdfInNode(Buffer.from('%PDF-1.4 broken')).error).toMatch(
      /^The file could not be read/,
    );
  }, 60000);

  it('joins wrapped PDF cell text into its row and repeats the header on the next page', () => {
    const at = (page: number, y: number, x: number, text: string) => ({
      page,
      y,
      x,
      text,
      width: text.length * 4.5,
    });
    const items = [
      at(1, 800, 40, 'Visits'),
      ...['S.No', 'Date', 'Place', 'Purpose / Title', 'Details'].map(
        (text, i) => at(1, 760, [40, 90, 190, 300, 520][i], text),
      ),
      at(1, 740, 40, '1'),
      at(1, 740, 90, '12-09-2026'),
      at(1, 740, 190, 'Macherla'),
      at(1, 740, 300, 'Road inspection'),
      at(1, 740, 520, 'Checked the bypass'),
      at(1, 729, 520, 'and the drains'),
      at(1, 200, 520, 'Page 1 of 2'),
      ...['S.No', 'Date', 'Place', 'Purpose / Title', 'Details'].map(
        (text, i) => at(2, 760, [40, 90, 190, 300, 520][i], text),
      ),
      at(2, 740, 40, '2'),
      at(2, 740, 90, '15-09-2026'),
      at(2, 740, 190, 'Gurazala'),
      at(2, 740, 300, 'Farmers'),
      at(2, 729, 300, 'meeting'),
    ];
    const grid = gridFromPdfItems(items)!;
    const { rows } = rowsFromGrids([grid]);
    expect(rows).toEqual([
      {
        where: 'Page 1, row 1',
        title: 'Road inspection',
        place: 'Macherla',
        visitDate: '2026-09-12',
        visitTime: '',
        detail: 'Checked the bypass\nand the drains',
        leadPhone: '',
      },
      {
        where: 'Page 2, row 1',
        title: 'Farmers meeting',
        place: 'Gurazala',
        visitDate: '2026-09-15',
        visitTime: '',
        detail: '',
        leadPhone: '',
      },
    ]);
  });

  it('explains what is wrong with files it cannot use', async () => {
    await expect(
      readVisitRows('excel', 'xls', Buffer.alloc(8)),
    ).rejects.toThrow('Save As > Excel Workbook');
    await expect(readVisitRows('word', 'doc', Buffer.alloc(8))).rejects.toThrow(
      'Save As > Word Document',
    );
    await expect(
      readVisitRows('word', 'docx', await wordFile([])),
    ).rejects.toThrow('No table was found');
    await expect(
      readVisitRows(
        'excel',
        'xlsx',
        await excelFile([
          ['Name', 'Phone'],
          ['A', '1'],
        ]),
      ),
    ).rejects.toThrow('header row was not found');
  });
});
