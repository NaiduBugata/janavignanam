import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

function findPdfjsPath(): string {
  const candidates = [
    resolve(__dirname, '../../node_modules/pdfjs-dist/legacy/build/pdf.mjs'),
    resolve(process.cwd(), 'node_modules/pdfjs-dist/legacy/build/pdf.mjs'),
    resolve(process.cwd(), 'server/node_modules/pdfjs-dist/legacy/build/pdf.mjs'),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return pathToFileURL(candidate).href;
  }
  return 'pdfjs-dist/legacy/build/pdf.mjs';
}

export interface GrievanceExtractedData {
  applicantName?: string;
  contactNumber?: string;
  referenceNumber?: string;
  date?: string;
  category?: string;
  village?: string;
  mandal?: string;
  division?: string;
  assemblyConstituency?: string;
  assignedOfficer?: string;
  actionRequested?: string;
  issueSummary?: string;
  rawJson?: Record<string, unknown>;
}

export interface GrokScanResult {
  extractedText: string;
  structuredData: GrievanceExtractedData;
  modelUsed: string;
  scannedAt: string;
}

const importEsm = new Function('specifier', 'return import(specifier)') as (
  specifier: string,
) => Promise<unknown>;

@Injectable()
export class GrokScannerService {
  private readonly logger = new Logger(GrokScannerService.name);

  constructor(private readonly config: ConfigService) {}

  get apiKey(): string {
    return (
      this.config.get<string>('XAI_API_KEY') ||
      this.config.get<string>('GROK_API_KEY') ||
      process.env.XAI_API_KEY ||
      process.env.GROK_API_KEY ||
      ''
    ).trim();
  }

  get baseUrl(): string {
    const raw =
      this.config.get<string>('XAI_BASE_URL') ||
      process.env.XAI_BASE_URL ||
      'https://api.x.ai/v1';
    return raw.replace(/\/+$/, '');
  }

  get visionModel(): string {
    return (
      this.config.get<string>('GROK_VISION_MODEL') ||
      process.env.GROK_VISION_MODEL ||
      'grok-2-vision-1212'
    );
  }

  get chatModel(): string {
    return (
      this.config.get<string>('GROK_CHAT_MODEL') ||
      process.env.GROK_CHAT_MODEL ||
      'grok-2-latest'
    );
  }

  isConfigured(): boolean {
    return Boolean(this.apiKey);
  }

  /**
   * Scans a document (PDF, JPG, JPEG, PNG) using the official xAI Grok API.
   * Extracts accurate layout/text and returns structured grievance JSON.
   */
  async scanDocument(input: {
    buffer: Buffer;
    mimeType: string;
    filename: string;
  }): Promise<GrokScanResult> {
    const normalizedMime = input.mimeType.toLowerCase().trim();
    const isPdf =
      normalizedMime === 'application/pdf' ||
      input.filename.toLowerCase().endsWith('.pdf');
    const isImage =
      normalizedMime.startsWith('image/') ||
      /\.(jpe?g|png)$/i.test(input.filename);

    if (!isPdf && !isImage) {
      throw new Error(
        `Unsupported document format "${input.mimeType}". Please upload a PDF, JPG, JPEG, or PNG file.`,
      );
    }

    if (!this.apiKey) {
      throw new Error(
        'xAI Grok API key is not configured. Please set XAI_API_KEY in the server environment variables.',
      );
    }

    if (isImage) {
      return this.scanImage(input.buffer, normalizedMime || 'image/jpeg');
    }

    return this.scanPdf(input.buffer, input.filename);
  }

  /**
   * Process an image (scanned grievance petition, letter, slip) with Grok Vision.
   */
  private async scanImage(
    buffer: Buffer,
    mimeType: string,
  ): Promise<GrokScanResult> {
    const validMime =
      mimeType === 'image/png' ? 'image/png' : 'image/jpeg';
    const base64Data = buffer.toString('base64');
    const dataUrl = `data:${validMime};base64,${base64Data}`;

    const prompt = this.buildExtractionPrompt();

    const payload = {
      model: this.visionModel,
      messages: [
        {
          role: 'system',
          content:
            'You are Grok, an advanced AI document scanner and text extraction specialist integrated into an official constituency grievance management system. ' +
            'Your task is to accurately transcribe all visible text, including headings, paragraphs, lists, tables, reference numbers, dates, applicant names, addresses, and official endorsements. ' +
            'Preserve document layout and tables where possible. Then output a structured JSON summary at the end.',
        },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: prompt,
            },
            {
              type: 'image_url',
              image_url: {
                url: dataUrl,
              },
            },
          ],
        },
      ],
      temperature: 0.1,
      max_tokens: 4096,
    };

    const responseText = await this.callGrokApi(payload);
    const { extractedText, structuredData } =
      this.parseGrokResponse(responseText);

    return {
      extractedText,
      structuredData,
      modelUsed: this.visionModel,
      scannedAt: new Date().toISOString(),
    };
  }

  /**
   * Process a PDF document:
   * 1. Extracts digital text via pdfjs-dist.
   * 2. If the PDF is scanned (little/no digital text), extracts embedded image or scans page.
   * 3. Feeds content to Grok for high-accuracy layout preservation and structured data.
   */
  private async scanPdf(
    buffer: Buffer,
    filename: string,
  ): Promise<GrokScanResult> {
    // 1. Attempt digital text extraction
    let digitalText = '';
    try {
      digitalText = await this.extractPdfText(buffer);
    } catch (err) {
      this.logger.warn(
        `Digital PDF text extraction skipped for ${filename}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // 2. If scanned PDF with minimal digital text, check for embedded image
    if (digitalText.trim().length < 30) {
      const embeddedJpeg = this.extractJpegFromPdf(buffer);
      if (embeddedJpeg) {
        this.logger.log(
          `Scanned PDF detected (${filename}). Extracted embedded page image (${embeddedJpeg.length} bytes) for Grok Vision processing.`,
        );
        return this.scanImage(embeddedJpeg, 'image/jpeg');
      }
    }

    // 3. Process PDF text with Grok Chat Completion
    const prompt = `${this.buildExtractionPrompt()}\n\n---\nDOCUMENT RAW CONTENT FROM "${filename}":\n${digitalText || '(No digital text found; scanned petition)'}`;

    const payload = {
      model: this.chatModel,
      messages: [
        {
          role: 'system',
          content:
            'You are Grok, an expert document transcription and information extraction engine for constituency grievance petitions and public representations. ' +
            'Organize and reconstruct the raw document text into clean, structured Markdown preserving headings, paragraphs, tables, dates, reference numbers, and applicant details. ' +
            'At the end, output the structured JSON block.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      temperature: 0.1,
      max_tokens: 4096,
    };

    const responseText = await this.callGrokApi(payload);
    const { extractedText, structuredData } =
      this.parseGrokResponse(responseText);

    return {
      extractedText: extractedText || digitalText,
      structuredData,
      modelUsed: this.chatModel,
      scannedAt: new Date().toISOString(),
    };
  }

  /**
   * Call the official xAI Grok completions endpoint.
   */
  private async callGrokApi(payload: Record<string, unknown>): Promise<string> {
    const url = `${this.baseUrl}/chat/completions`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!res.ok) {
        const errorBody = await res.text().catch(() => '');
        let parsedMessage = '';
        try {
          const parsed = JSON.parse(errorBody);
          parsedMessage =
            parsed.error?.message || parsed.message || errorBody;
        } catch {
          parsedMessage = errorBody;
        }
        throw new Error(
          `xAI Grok API returned HTTP ${res.status}: ${parsedMessage || res.statusText}`,
        );
      }

      const json = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };

      const content = json.choices?.[0]?.message?.content;
      if (!content) {
        throw new Error('xAI Grok API returned an empty completion response.');
      }

      return content;
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error(
          'xAI Grok API request timed out after 60 seconds. Please try again.',
        );
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Extracts text from digital PDF using pdfjs-dist.
   */
  private async extractPdfText(buffer: Buffer): Promise<string> {
    const pdfjsSpecifier = findPdfjsPath();
    const pdfjs = (await importEsm(
      pdfjsSpecifier,
    )) as typeof import('pdfjs-dist/legacy/build/pdf.mjs');

    const loadingTask = pdfjs.getDocument({
      data: new Uint8Array(buffer),
      disableFontFace: true,
      useSystemFonts: false,
      verbosity: 0,
    });

    try {
      const doc = await loadingTask.promise;
      const pagesText: string[] = [];

      for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
        const page = await doc.getPage(pageNum);
        const textContent = await page.getTextContent();
        const pageLines: string[] = [];
        let currentLine = '';

        for (const item of textContent.items) {
          if (!('str' in item)) continue;
          if (item.hasEOL) {
            currentLine += item.str;
            pageLines.push(currentLine.trim());
            currentLine = '';
          } else {
            currentLine += item.str + ' ';
          }
        }
        if (currentLine.trim()) {
          pageLines.push(currentLine.trim());
        }

        pagesText.push(
          `--- Page ${pageNum} ---\n` + pageLines.filter(Boolean).join('\n'),
        );
      }

      return pagesText.join('\n\n');
    } finally {
      await loadingTask.destroy();
    }
  }

  /**
   * Extract embedded JPEG stream from scanned PDF file buffer.
   */
  private extractJpegFromPdf(pdfBuffer: Buffer): Buffer | null {
    const soi = Buffer.from([0xff, 0xd8, 0xff]);
    const eoi = Buffer.from([0xff, 0xd9]);

    const startIndex = pdfBuffer.indexOf(soi);
    if (startIndex === -1) return null;

    const endIndex = pdfBuffer.indexOf(eoi, startIndex);
    if (endIndex === -1) return null;

    return pdfBuffer.subarray(startIndex, endIndex + 2);
  }

  /**
   * Extraction prompt instruction.
   */
  private buildExtractionPrompt(): string {
    return (
      'Please scan and extract all text and details from this grievance document accurately.\n\n' +
      '1. Transcribe the entire document preserving all headings, paragraphs, bullet points, tables, applicant names, addresses, dates, and reference numbers.\n' +
      '2. At the end of your response, output a structured JSON code block enclosed in ```json and ``` with the following keys:\n' +
      '{\n' +
      '  "applicantName": string | null,\n' +
      '  "contactNumber": string | null,\n' +
      '  "referenceNumber": string | null,\n' +
      '  "date": string | null (format: YYYY-MM-DD if recognizable),\n' +
      '  "category": string | null (e.g. Roads & Infrastructure, Water Resources, Revenue & Land, CMRF / Medical, Agriculture, Housing, Public Grievance, etc.),\n' +
      '  "village": string | null,\n' +
      '  "mandal": string | null,\n' +
      '  "division": string | null,\n' +
      '  "assemblyConstituency": string | null,\n' +
      '  "assignedOfficer": string | null,\n' +
      '  "actionRequested": string | null,\n' +
      '  "issueSummary": string\n' +
      '}\n'
    );
  }

  /**
   * Parses the text and JSON block returned by Grok.
   */
  parseGrokResponse(content: string): {
    extractedText: string;
    structuredData: GrievanceExtractedData;
  } {
    const jsonMatch = /```(?:json)?\s*([\s\S]*?)\s*```/.exec(content);
    let structuredData: GrievanceExtractedData = {
      issueSummary: '',
    };
    let extractedText = content.trim();

    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[1]);
        if (parsed && typeof parsed === 'object') {
          structuredData = {
            applicantName: strOrNull(parsed.applicantName),
            contactNumber: strOrNull(parsed.contactNumber),
            referenceNumber: strOrNull(parsed.referenceNumber),
            date: strOrNull(parsed.date),
            category: strOrNull(parsed.category),
            village: strOrNull(parsed.village),
            mandal: strOrNull(parsed.mandal),
            division: strOrNull(parsed.division),
            assemblyConstituency: strOrNull(parsed.assemblyConstituency),
            assignedOfficer: strOrNull(parsed.assignedOfficer),
            actionRequested: strOrNull(parsed.actionRequested),
            issueSummary: String(parsed.issueSummary || '').trim(),
            rawJson: parsed,
          };
          // Remove the JSON code block from the user-facing extracted document text
          extractedText = content
            .replace(jsonMatch[0], '')
            .trim();
        }
      } catch (err) {
        this.logger.warn(`Failed to parse JSON block from Grok: ${err}`);
      }
    }

    if (!extractedText) {
      extractedText = content.trim();
    }

    return {
      extractedText,
      structuredData,
    };
  }
}

function strOrNull(val: unknown): string | undefined {
  if (typeof val === 'string' && val.trim().length > 0) {
    return val.trim();
  }
  return undefined;
}
