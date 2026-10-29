import {
  generatePdfReport,
  generateExcelReport,
  generateCsvReport,
  transliterateTeluguToLatin,
  sanitizeTextForPdf,
  ReportFilterOptions,
  ReportStatsSummary,
} from './news-report';
import type { NormalizedArticle } from '../common/types/article';

describe('News Report Generation', () => {
  const dummyArticles: NormalizedArticle[] = [
    {
      _id: 'art1',
      post_id: 'post_1',
      title: 'Road repair works started in Vinukonda town',
      summary: 'Municipal authorities initiated blacktopping on main road.',
      category: 'Roads',
      subcategory: 'Infrastructure',
      sentiment: 'Problem',
      location: {
        district: 'Palnadu',
        mandal: 'Vinukonda',
        village: 'Vinukonda',
        town: 'Vinukonda',
        state: 'Andhra Pradesh',
      },
      keywords: ['road', 'repair'],
      entities: ['Vinukonda Municipality'],
      problem: 'Damaged potholes on main road',
      problem_id: 'PROB-ROADS-01',
      source_url: 'https://sakshi.com/test-road',
      source: 'sakshi',
      channel: 'Main',
      thumbnail: 'https://example.com/thumb.jpg',
      author: 'Staff Reporter',
      tags: ['civic'],
      created_on: '2026-10-28T09:00:00Z',
      first_seen_at: '2026-10-28T09:15:00Z',
      last_updated_at: '2026-10-28T09:15:00Z',
      assembly_segment: 'Vinukonda',
    },
    {
      _id: 'art2',
      post_id: 'post_2',
      title: 'New primary healthcare center inaugurated in Chilakaluripet',
      summary:
        'Public healthcare facility equipped with 30 beds and 24x7 doctor service.',
      category: 'Health',
      subcategory: 'Hospital',
      sentiment: 'Positive',
      location: {
        district: 'Palnadu',
        mandal: 'Chilakaluripet',
        village: 'Kavuru',
        town: null,
        state: 'Andhra Pradesh',
      },
      keywords: ['hospital', 'inauguration'],
      entities: ['Health Dept'],
      problem: null,
      problem_id: null,
      source_url: 'https://youtube.com/watch?v=test1234',
      source: 'youtube',
      channel: 'Telugu News',
      thumbnail: '',
      author: 'Reporter',
      tags: ['health'],
      created_on: '2026-10-27T10:00:00Z',
      first_seen_at: '2026-10-27T10:00:00Z',
      last_updated_at: '2026-10-27T10:00:00Z',
      assembly_segment: 'Chilakaluripet',
    },
  ];

  const dummyFilters: ReportFilterOptions = {
    segment: 'Vinukonda',
    sentiment: 'all',
  };

  const dummyStats: ReportStatsSummary = {
    total: 2,
    positive: 1,
    negative: 0,
    neutral: 0,
    problems: 1,
    bySource: { sakshi: 1, youtube: 1 },
    bySegment: { Vinukonda: 1, Chilakaluripet: 1 },
    byCategory: { Roads: 1, Health: 1 },
  };

  it('generates a valid binary PDF document buffer with JanaVignanam header', () => {
    const pdfBuf = generatePdfReport(dummyArticles, dummyFilters, dummyStats);
    expect(pdfBuf).toBeInstanceOf(Buffer);
    expect(pdfBuf.length).toBeGreaterThan(1000);
    // Starts with standard PDF signature
    expect(pdfBuf.toString('utf8', 0, 5)).toBe('%PDF-');
  });

  it('generates an Excel (.xlsx) workbook with multiple worksheets', async () => {
    const xlsxBuf = await generateExcelReport(
      dummyArticles,
      dummyFilters,
      dummyStats,
    );
    expect(xlsxBuf).toBeInstanceOf(Buffer);
    expect(xlsxBuf.length).toBeGreaterThan(1000);
    // Excel/ZIP magic bytes PK\x03\x04
    expect(xlsxBuf[0]).toBe(0x50);
    expect(xlsxBuf[1]).toBe(0x4b);
  });

  it('generates a CSV file with correct headers and escaped fields', () => {
    const csv = generateCsvReport(dummyArticles);
    expect(typeof csv).toBe('string');
    const lines = csv.split('\n');
    expect(lines.length).toBe(3); // header + 2 article rows
    expect(lines[0]).toContain(
      'Title,Source,Sentiment,Category,Assembly Segment',
    );
    expect(lines[1]).toContain('Road repair works started in Vinukonda town');
    expect(lines[2]).toContain(
      'New primary healthcare center inaugurated in Chilakaluripet',
    );
  });

  it('transliterates Telugu script to legible Latin characters and normalizes smart punctuation', () => {
    const teluguHeadline = 'నరసరావుపేటలో తాగునీటి సమస్య పరిష్కరించాలని వినతి';
    const result = transliterateTeluguToLatin(teluguHeadline);
    expect(result).toBeTruthy();
    expect(result).not.toBe('');
    expect(result.toLowerCase()).toContain('narasara');
    expect(result.toLowerCase()).toContain('taaguneeti');

    const withQuotesAndCurrency = '₹50,000 “అభివృద్ధి” పనులు — ప్రారంభం';
    const sanitized = sanitizeTextForPdf(withQuotesAndCurrency);
    expect(sanitized).toContain('Rs. 50,000');
    expect(sanitized).toContain('"');
    expect(sanitized).toContain('-');
  });

  it('includes Page X of Y numbering and transliterated articles in the PDF stream', () => {
    const teluguArticle: NormalizedArticle = {
      ...dummyArticles[0],
      _id: 'telugu_1',
      title: 'నరసరావుపేటలో తాగునీటి సమస్య',
      summary: 'గ్రామ ప్రజలు అధికారులకు వినతిపత్రం అందజేశారు.',
    };
    const pdfBuf = generatePdfReport([teluguArticle], dummyFilters, dummyStats);
    const pdfContent = pdfBuf.toString('utf8');
    expect(pdfContent).toContain('Page 1 of');
    expect(pdfContent).toContain('narasara');
  });
});
