import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { TEMPLATE_EXAMPLE, TEMPLATE_HEADERS } from './visits-import';

export const TEMPLATE_INSTRUCTIONS = [
  'One row per visit. Keep the header row exactly as it is.',
  'Date: day-month-year, for example 28-09-2026.',
  'Time: for example 10:30 AM, 2 PM, 14:30, or a range such as 10 AM - 12:30 PM. Leave it empty if not known.',
  'Purpose / Title is required. If it is empty, the Place is used ("Visit to Vinukonda").',
  'Delete the example row before uploading. It is skipped anyway.',
  'Upload this file in Admin > Visits > "Upload all visits (one file)". You may also save it as PDF and upload the PDF.',
  'Rows already on the site are skipped, so you can keep adding rows to the same file and upload it again.',
  'Lead phone is optional. It is used only to send a WhatsApp follow-up and is not shown on the site or in the visits chat.',
];

const EXAMPLE_CELLS = [
  '1',
  TEMPLATE_EXAMPLE.date,
  TEMPLATE_EXAMPLE.time,
  TEMPLATE_EXAMPLE.place,
  TEMPLATE_EXAMPLE.title,
  TEMPLATE_EXAMPLE.detail,
  '9876543210',
];

export async function excelTemplate(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'JanaVignanam';
  const sheet = workbook.addWorksheet('Visits', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });
  sheet.columns = [
    { header: TEMPLATE_HEADERS[0], key: 'sno', width: 7 },
    {
      header: TEMPLATE_HEADERS[1],
      key: 'date',
      width: 18,
      style: { numFmt: 'dd-mm-yyyy' },
    },
    {
      header: TEMPLATE_HEADERS[2],
      key: 'time',
      width: 16,
      style: { numFmt: 'h:mm AM/PM' },
    },
    { header: TEMPLATE_HEADERS[3], key: 'place', width: 22 },
    { header: TEMPLATE_HEADERS[4], key: 'title', width: 42 },
    { header: TEMPLATE_HEADERS[5], key: 'detail', width: 48 },
    { header: TEMPLATE_HEADERS[6], key: 'phone', width: 22 },
  ];
  const header = sheet.getRow(1);
  header.font = { bold: true, color: { argb: 'FF1F2937' } };
  header.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFF2A33A' },
  };
  header.alignment = { vertical: 'middle' };
  header.height = 22;
  const [day, month, year] = TEMPLATE_EXAMPLE.date.split('-').map(Number);
  const example = sheet.addRow({
    sno: 1,
    date: new Date(Date.UTC(year, month - 1, day)),
    time: new Date(Date.UTC(1899, 11, 30, 10, 30)),
    place: TEMPLATE_EXAMPLE.place,
    title: TEMPLATE_EXAMPLE.title,
    detail: TEMPLATE_EXAMPLE.detail,
    phone: '9876543210',
  });
  example.font = { italic: true, color: { argb: 'FF6B7280' } };
  sheet.getColumn('detail').alignment = { wrapText: true, vertical: 'top' };
  sheet.getColumn('title').alignment = { wrapText: true, vertical: 'top' };

  const help = workbook.addWorksheet('How to fill');
  help.getColumn(1).width = 110;
  help.addRow(['How to fill the Visits sheet']).font = { bold: true, size: 13 };
  for (const line of TEMPLATE_INSTRUCTIONS) help.addRow([`• ${line}`]);

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function run(text: string, props = ''): string {
  return `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ''}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`;
}

function paragraph(text: string, props = ''): string {
  return `<w:p><w:pPr><w:spacing w:after="80"/></w:pPr>${run(text, props)}</w:p>`;
}

const WIDTHS = [700, 1600, 1400, 2000, 3200, 3600, 1800];

function row(cells: string[], kind: 'header' | 'example' | 'empty'): string {
  const rowProps =
    kind === 'header'
      ? '<w:trPr><w:tblHeader/><w:trHeight w:val="420"/></w:trPr>'
      : '<w:trPr><w:trHeight w:val="420"/></w:trPr>';
  const runProps =
    kind === 'header'
      ? '<w:b/>'
      : kind === 'example'
        ? '<w:i/><w:color w:val="6B7280"/>'
        : '';
  const shade =
    kind === 'header'
      ? '<w:shd w:val="clear" w:color="auto" w:fill="F2A33A"/>'
      : '';
  const tcs = cells
    .map(
      (text, index) =>
        `<w:tc><w:tcPr><w:tcW w:w="${WIDTHS[index]}" w:type="dxa"/>${shade}</w:tcPr><w:p>${text ? run(text, runProps) : ''}</w:p></w:tc>`,
    )
    .join('');
  return `<w:tr>${rowProps}${tcs}</w:tr>`;
}

export async function wordTemplate(): Promise<Buffer> {
  const border = (side: string) =>
    `<w:${side} w:val="single" w:sz="6" w:space="0" w:color="9CA3AF"/>`;
  const table = [
    '<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblBorders>',
    ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
      .map(border)
      .join(''),
    '</w:tblBorders><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid>',
    WIDTHS.map((width) => `<w:gridCol w:w="${width}"/>`).join(''),
    '</w:tblGrid>',
    row(TEMPLATE_HEADERS, 'header'),
    row(EXAMPLE_CELLS, 'example'),
    ...Array.from({ length: 15 }, (_, index) =>
      row([String(index + 2), '', '', '', '', '', ''], 'empty'),
    ),
    '</w:tbl>',
  ].join('');

  const document = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>',
    paragraph('Visits', '<w:b/><w:sz w:val="36"/>'),
    ...TEMPLATE_INSTRUCTIONS.map((line) =>
      paragraph(`• ${line}`, '<w:color w:val="4B5563"/><w:sz w:val="20"/>'),
    ),
    table,
    '<w:p/>',
    '<w:sectPr><w:pgSz w:w="16838" w:h="11906" w:orient="landscape"/>',
    '<w:pgMar w:top="900" w:right="900" w:bottom="900" w:left="900" w:header="500" w:footer="500" w:gutter="0"/></w:sectPr>',
    '</w:body></w:document>',
  ].join('');

  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '</Types>',
  );
  zip.file(
    '_rels/.rels',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
      '</Relationships>',
  );
  zip.file('word/document.xml', document);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}
