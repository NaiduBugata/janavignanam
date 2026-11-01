import { ConfigService } from '@nestjs/config';
import {
  GrokScannerService,
  matchIssueCategories,
  repairSlipOcr,
  tickedCategories,
} from './grok-scanner.service';

describe('GrokScannerService', () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('checks whether API key is configured', () => {
    const unconfigured = new GrokScannerService({
      get: () => '',
    } as unknown as ConfigService);
    expect(unconfigured.isConfigured()).toBe(false);

    const configured = new GrokScannerService({
      get: (key: string) => (key === 'XAI_API_KEY' ? 'xai-test-key' : ''),
    } as unknown as ConfigService);
    expect(configured.isConfigured()).toBe(true);
    expect(configured.apiKey).toBe('xai-test-key');
  });

  it('maps Groq categories and day-first dates onto the grievance form', () => {
    expect(matchIssueCategories(['Roads and Infrastructure, Agriculture'])).toEqual([
      'Agriculture',
      'Roads & Infrastructure',
    ]);
  });

  it('maps the visitor slip onto the form fields without the sample person', () => {
    const broken = [
      'LAVU SRI KRISHNA DEVARAYALU',
      'SR. NUMBER : 00l73',
      'FULL NAME : K. Ramesh Naidu',
      'CONTACT NUMBER : 6281/68530',
      'ADDRESS : D.No: 8-24, Main Road',
      'EMAIL : rameshnaidu.k@gmail.com',
      'VILLAGE : Peddanandipadu',
      'MANDAL : Narasaracpet',
      'ASSEMBLY CONSTITUENCY : Narasaraopet',
      'DATE OF VISIT : 3/-/0-2026',
      'REFERENCE NAME : M. Narasimha Rao',
      'REFERENCE NUMBER : REF //426 /2026',
      'Request for installation of street lights on the Peddanandipadu Main Road (from Bus Stand to School).',
      'ACTION TAKEN : Issue verified and forwarded to the Electricity Department.',
      'ACTION TO BE TAKEN : Installation of street lights and completion of necessary field inspection.',
      'ASSIGNED OFFICER : AE, R&B (Narasaraopet) 8885230708',
      'RESOLUTION STATUS : ( ) PENDING (Y) IN PROGRESS ( ) RESOLVED',
      'DEADLINE : /5 ~// - 2026',
    ].join('\n');

    expect(repairSlipOcr(broken)).toContain('31-10-2026');
    expect(repairSlipOcr(broken)).toContain('REF/1426/2026');
    expect(repairSlipOcr(broken)).toContain('6281168530');
    expect(repairSlipOcr(broken)).toContain('15-11-2026');

    const scanner = new GrokScannerService({
      get: () => '',
    } as unknown as ConfigService);
    const mapped = scanner.normalizeGrievanceData(
      {
        applicantName: 'Ramesh Naidu',
        date: '2026-10-03',
        referenceNumber: '426/2026',
        categories: ['Roads & Infrastructure', 'Electricity', 'Public Grievance'],
        issueSummary:
          'Request for installation of street lights on the Peddanandipadu Main Road (from Bus Stand to School). The area remains dark at night.',
        resolutionStatus: 'Pending',
      },
      broken,
      'visitor-slip.jpg',
    );

    expect(mapped.applicantName).toBe('K. Ramesh Naidu');
    expect(mapped.applicantName).not.toContain('Praveen');
    expect(mapped.contactNumber).toBe('6281168530');
    expect(mapped.address).toBe('D.No: 8-24, Main Road');
    expect(mapped.email).toBe('rameshnaidu.k@gmail.com');
    expect(mapped.village).toBe('Peddanandipadu');
    expect(mapped.mandal).toBe('Narasaraopet');
    expect(mapped.assemblyConstituency).toBe('Narasaraopet');
    expect(mapped.date).toBe('2026-10-31');
    expect(mapped.deadline).toBe('2026-11-15');
    expect(mapped.referenceName).toBe('M. Narasimha Rao');
    expect(mapped.referenceNumber).toBe('REF/1426/2026');
    expect(mapped.srNumber).toBe('00173');
    expect(mapped.categories).toEqual(['Electricity']);
    expect(mapped.assignedOfficer).toBe('AE, R&B (Narasaraopet)');
    expect(mapped.assignedOfficerPhone).toBe('8885230708');
    expect(mapped.resolutionStatus).toBe('In progress');
    expect(mapped.actionTaken).toContain('Electricity Department');
    expect(mapped.actionRequested).toContain('street lights');
  });

  it('keeps only the ticked category boxes', () => {
    const slip = [
      '(CD Banking & Financial Issues (.) Roads & Infrastructure Ow Electricity',
      'C) Irrigation & Water Resources (©) Housing w Revenue & Land Issues',
      '() Public Grievance',
      'Others: Power Supply & Land Records',
    ].join('\n');
    expect(tickedCategories(slip)).toEqual(['Electricity', 'Revenue & Land Issues']);
  });

  it('reads a Groq answer from the reasoning field when content is empty', async () => {
    process.env.GROQ_API_KEY = 'test-key';
    global.fetch = jest.fn().mockImplementation(async () => ({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: '',
              reasoning:
                '{"srNumber":"44","applicantName":"Sita Rao","contactNumber":"9876543210","date":"31-10-2026","deadline":"15-11-2026","category":"Roads and Infrastructure","resolutionStatus":"IN PROGRESS","issueSummary":"Repair the village road near the school"}',
            },
          },
        ],
      }),
    }));
    const text =
      'BT (FULL NAME : Sita Rao CONTACT NUMBER : 9876543210 DATE 31-10-2026) Tj ET';
    const pdf = Buffer.from(
      `%PDF-1.1\n1 0 obj<<>>stream\n${text}\nendstream\nendobj\n`,
    );
    const s = new GrokScannerService({
      get: () => '',
    } as unknown as ConfigService);
    try {
      const result = await s.scanDocument({
        buffer: pdf,
        mimeType: 'application/pdf',
        filename: 'sita-rao.pdf',
      });
      expect(result.modelUsed).toContain('groq');
      expect(result.structuredData.applicantName).toBe('Sita Rao');
      expect(result.structuredData.contactNumber).toBe('9876543210');
      expect(result.structuredData.date).toBe('2026-10-31');
      expect(result.structuredData.deadline).toBe('2026-11-15');
      expect(result.structuredData.resolutionStatus).toBe('In progress');
      expect(result.structuredData.categories).toContain('Roads & Infrastructure');
    } finally {
      delete process.env.GROQ_API_KEY;
    }
  });

  it('rejects unsupported file formats', async () => {
    const s = new GrokScannerService({
      get: () => 'xai-test-key',
    } as unknown as ConfigService);

    await expect(
      s.scanDocument({
        buffer: Buffer.from('test'),
        mimeType: 'text/plain',
        filename: 'notes.txt',
      }),
    ).rejects.toThrow('Unsupported document format');
  });

  it('falls back gracefully to heuristic extraction when API key is missing instead of throwing', async () => {
    const s = new GrokScannerService({
      get: () => '',
    } as unknown as ConfigService);

    const result = await s.scanDocument({
      buffer: Buffer.from('fake-image-bytes'),
      mimeType: 'image/jpeg',
      filename: 'petition_Lakshmi_Chilakaluripet.jpg',
    });

    expect(result).toBeDefined();
    expect(result.structuredData).toBeDefined();
    expect(result.structuredData.applicantName).toContain('Lakshmi');
    expect(result.modelUsed).toContain('XAI_API_KEY needed');
    expect(result.extractedText).toContain('petition_Lakshmi_Chilakaluripet.jpg');
  });

  it('processes image document via Grok Vision API and parses structured grievance JSON', async () => {
    const mockApiResponse = {
      choices: [
        {
          message: {
            content:
              '# Grievance Petition\n' +
              '**Applicant:** K. Venkateswara Rao\n' +
              '**Date:** 2026-10-15\n' +
              '**Reference:** GR/2026/8941\n\n' +
              'Subject: Request for repair of damaged irrigation canal in Chilakaluripet mandal.\n\n' +
              'The main branch canal has breached near ward 4.\n\n' +
              '```json\n' +
              '{\n' +
              '  "applicantName": "K. Venkateswara Rao",\n' +
              '  "contactNumber": "9876543210",\n' +
              '  "referenceNumber": "GR/2026/8941",\n' +
              '  "date": "2026-10-15",\n' +
              '  "category": "Irrigation & Water Resources",\n' +
              '  "village": "Ganapavaram",\n' +
              '  "mandal": "Chilakaluripet",\n' +
              '  "division": "Narasaraopet",\n' +
              '  "assemblyConstituency": "Chilakaluripet",\n' +
              '  "assignedOfficer": "Executive Engineer, Irrigation",\n' +
              '  "actionRequested": "Immediate canal breach repair",\n' +
              '  "issueSummary": "Canal breach near ward 4 causing water disruption to agricultural lands"\n' +
              '}\n' +
              '```',
          },
        },
      ],
    };

    let requestedPayload: Record<string, unknown> | null = null;
    let requestAuthHeader = '';

    global.fetch = jest.fn().mockImplementation(async (url, init) => {
      requestedPayload = JSON.parse(init.body as string);
      requestAuthHeader = init.headers.Authorization;
      return {
        ok: true,
        json: async () => mockApiResponse,
      };
    });

    const s = new GrokScannerService({
      get: (k: string) => {
        if (k === 'XAI_API_KEY') return 'test-key-123';
        if (k === 'GROK_VISION_MODEL') return 'grok-2-vision-1212';
        return '';
      },
    } as unknown as ConfigService);

    const result = await s.scanDocument({
      buffer: Buffer.from('test-image-content'),
      mimeType: 'image/jpeg',
      filename: 'petition.jpg',
    });

    expect(requestAuthHeader).toBe('Bearer test-key-123');
    expect(requestedPayload).toBeDefined();
    expect(requestedPayload?.model).toBe('grok-2-vision-1212');

    expect(result.structuredData.applicantName).toBe('K. Venkateswara Rao');
    expect(result.structuredData.contactNumber).toBe('9876543210');
    expect(result.structuredData.referenceNumber).toBe('GR/2026/8941');
    expect(result.structuredData.category).toBe('Irrigation & Water Resources');
    expect(result.structuredData.mandal).toBe('Chilakaluripet');
    expect(result.extractedText).toContain('# Grievance Petition');
    expect(result.extractedText).not.toContain('```json');
  });

  it('handles Grok API error responses gracefully without crashing', async () => {
    global.fetch = jest.fn().mockImplementation(async () => {
      return {
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        text: async () =>
          JSON.stringify({
            error: { message: 'Incorrect API key provided' },
          }),
      };
    });

    const s = new GrokScannerService({
      get: () => 'invalid-key',
    } as unknown as ConfigService);

    const result = await s.scanDocument({
      buffer: Buffer.from('sample-buffer'),
      mimeType: 'image/png',
      filename: 'petition_Ramesh.png',
    });

    expect(result).toBeDefined();
    expect(result.modelUsed).toContain('xAI offline');
    expect(result.structuredData.applicantName).toContain('Ramesh');
  });

  it('extracts embedded JPEG from a scanned PDF and sends to Vision API', async () => {
    const fakeJpeg = Buffer.from([
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
      0xff, 0xd9,
    ]);
    const pdfPrefix = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Length 14 >>\nstream\n');
    const pdfSuffix = Buffer.from('\nendstream\nendobj\ntrailer<<>>%%EOF');
    const scannedPdfBuffer = Buffer.concat([pdfPrefix, fakeJpeg, pdfSuffix]);

    global.fetch = jest.fn().mockImplementation(async () => ({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content:
                'Scanned petition content from PDF.\n```json\n{"applicantName": "Ramesh", "issueSummary": "Pothole repair"}\n```',
            },
          },
        ],
      }),
    }));

    const s = new GrokScannerService({
      get: () => 'test-key',
    } as unknown as ConfigService);

    const result = await s.scanDocument({
      buffer: scannedPdfBuffer,
      mimeType: 'application/pdf',
      filename: 'scanned_letter.pdf',
    });

    expect(result.structuredData.applicantName).toBe('Ramesh');
    expect(result.structuredData.issueSummary).toBe('Pothole repair');
  });
});
