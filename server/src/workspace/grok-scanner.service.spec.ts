import { ConfigService } from '@nestjs/config';
import { GrokScannerService } from './grok-scanner.service';

describe('GrokScannerService', () => {
  let service: GrokScannerService;
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

  it('rejects scan when API key is missing', async () => {
    const s = new GrokScannerService({
      get: () => '',
    } as unknown as ConfigService);

    await expect(
      s.scanDocument({
        buffer: Buffer.from('fake-image-bytes'),
        mimeType: 'image/jpeg',
        filename: 'scan.jpg',
      }),
    ).rejects.toThrow('xAI Grok API key is not configured');
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

  it('handles Grok API error responses gracefully', async () => {
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

    await expect(
      s.scanDocument({
        buffer: Buffer.from('sample-buffer'),
        mimeType: 'image/png',
        filename: 'scan.png',
      }),
    ).rejects.toThrow('xAI Grok API returned HTTP 401: Incorrect API key provided');
  });

  it('extracts embedded JPEG from a scanned PDF and sends to Vision API', async () => {
    // Construct a minimal buffer containing SOI (\xFF\xD8\xFF) and EOI (\xFF\xD9)
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
