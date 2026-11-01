import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import zlib from 'node:zlib';

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

const PALNADU_CONSTITUENCIES = [
  'Pedakurapadu',
  'Chilakaluripet',
  'Narasaraopet',
  'Sattenapalle',
  'Vinukonda',
  'Gurazala',
  'Macherla',
];

const PALNADU_MANDALS = [
  'Chilakaluripet',
  'Edlapadu',
  'Nadendla',
  'Narasaraopet',
  'Rompicherla',
  'Vinukonda',
  'Nuzendla',
  'Savalyapuram',
  'Ipur',
  'Bollapalle',
  'Sattenapalle',
  'Rajupalem',
  'Bellamkonda',
  'Atchampet',
  'Krosuru',
  'Pedakurapadu',
  'Amaravathi',
  'Gurazala',
  'Dachepalle',
  'Piduguralla',
  'Machavaram',
  'Macherla',
  'Veldurthi',
  'Durgi',
  'Rentachintala',
  'Karempudi',
];

const CATEGORY_KEYWORDS: Array<{ category: string; keywords: string[] }> = [
  {
    category: 'Irrigation & Water Resources',
    keywords: ['water', 'irrigation', 'canal', 'borewell', 'drinking water', 'pipeline', 'tank', 'jal', 'water supply'],
  },
  {
    category: 'Roads & Infrastructure',
    keywords: ['road', 'pothole', 'street', 'drain', 'drainage', 'bridge', 'culvert', 'tar', 'cement', 'r&b'],
  },
  {
    category: 'Revenue & Land Issues',
    keywords: ['land', 'patta', 'survey', 'passbook', 'revenue', 'encroachment', 'boundary', 'registration', 'mutation'],
  },
  {
    category: 'Housing',
    keywords: ['house', 'housing', 'plot', 'site', 'pmay', 'yavari', 'colony', 'shelter', 'patta'],
  },
  {
    category: 'Pension & Social Welfare',
    keywords: ['pension', 'welfare', 'widow', 'disabled', 'handicapped', 'old age', 'cheyutha', 'aasara'],
  },
  {
    category: 'CMRF / Medical Assistance',
    keywords: ['cmrf', 'medical', 'hospital', 'treatment', 'surgery', 'health', 'financial assistance for treatment', 'aarogyasri'],
  },
  {
    category: 'Electricity',
    keywords: ['electricity', 'power', 'current', 'transformer', 'pole', 'line', 'voltage', 'meter'],
  },
  {
    category: 'Agriculture',
    keywords: ['agriculture', 'crop', 'farmer', 'fertilizer', 'seed', 'pesticide', 'loss', 'rythu'],
  },
  {
    category: 'Police / Law & Order',
    keywords: ['police', 'fir', 'complaint', 'harassment', 'theft', 'crime', 'law and order', 'station'],
  },
  {
    category: 'Education / Fee Concession',
    keywords: ['education', 'school', 'college', 'fee', 'student', 'scholarship', 'teacher', 'admission'],
  },
  {
    category: 'Employee Transfer',
    keywords: ['transfer', 'posting', 'employee', 'teacher transfer', 'deputation'],
  },
  {
    category: 'Recommendation / Request Letter',
    keywords: ['recommendation', 'recommend', 'request letter', 'endorsement'],
  },
  {
    category: 'Banking & Financial Issues',
    keywords: ['bank', 'loan', 'credit', 'subsidy', 'interest', 'branch'],
  },
];

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
   * Scans a document (PDF, JPG, JPEG, PNG).
   * Uses xAI Grok Vision/Chat API when available; falls back to local intelligent
   * extraction so the workflow never crashes or throws 500 errors.
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

    if (isImage) {
      return this.scanImage(input.buffer, normalizedMime || 'image/jpeg', input.filename);
    }

    return this.scanPdf(input.buffer, input.filename);
  }

  /**
   * Process an image (scanned grievance petition, letter, slip) with Grok Vision.
   */
  private async scanImage(
    buffer: Buffer,
    mimeType: string,
    filename: string,
  ): Promise<GrokScanResult> {
    const validMime = mimeType === 'image/png' ? 'image/png' : 'image/jpeg';
    const base64Data = buffer.toString('base64');
    const dataUrl = `data:${validMime};base64,${base64Data}`;

    // 1. Try xAI Grok Vision API if configured
    if (this.apiKey) {
      try {
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
                { type: 'text', text: prompt },
                { type: 'image_url', image_url: { url: dataUrl } },
              ],
            },
          ],
          temperature: 0.1,
          max_tokens: 4096,
        };

        const responseText = await this.callGrokApi(payload);
        const { extractedText, structuredData } = this.parseGrokResponse(responseText);

        return {
          extractedText,
          structuredData,
          modelUsed: this.visionModel,
          scannedAt: new Date().toISOString(),
        };
      } catch (err) {
        this.logger.warn(
          `xAI Grok Vision call failed: ${err instanceof Error ? err.message : String(err)}. Checking secondary AI fallback.`,
        );
      }
    }

    // 2. Secondary Groq Vision fallback if GROQ_API_KEY is available in environment
    const groqKey = (process.env.GROQ_API_KEY || this.config.get<string>('GROQ_API_KEY') || '').trim();
    if (groqKey) {
      try {
        const groqResult = await this.callGroqVision(groqKey, dataUrl, filename);
        if (groqResult) return groqResult;
      } catch (err) {
        this.logger.warn(`Groq Vision fallback call failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // 3. Fallback extraction from filename and image metadata so workflow never fails
    const structuredData = this.heuristicExtraction('', filename);
    const noticeText = this.apiKey
      ? `# Scanned Document: ${filename}\n[Image file attached (${(buffer.length / 1024).toFixed(1)} KB)]\n` +
        `Note: xAI Grok Vision API temporary error encountered. Basic grievance metadata registered.`
      : `# Scanned Document: ${filename}\n[Image file attached (${(buffer.length / 1024).toFixed(1)} KB)]\n` +
        `Note: To enable official xAI Grok Vision OCR scanning, configure XAI_API_KEY in your Railway environment variables.`;

    return {
      extractedText: noticeText,
      structuredData,
      modelUsed: this.apiKey ? 'image-registered (xAI offline)' : 'image-registered (XAI_API_KEY needed)',
      scannedAt: new Date().toISOString(),
    };
  }

  /**
   * Process a PDF document:
   * 1. Extracts digital text via pdfjs-dist / stream parsing.
   * 2. If scanned PDF, extracts embedded page image and calls vision.
   * 3. Sends to Grok Chat/Vision API if key configured; otherwise uses heuristic extraction.
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
        `Digital PDF text extraction error for ${filename}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // 2. Fallback stream text extraction if pdfjs returned little text
    if (digitalText.trim().length < 20) {
      const streamText = this.extractStreamText(buffer);
      if (streamText.trim().length > digitalText.trim().length) {
        digitalText = streamText;
      }
    }

    // 3. If scanned PDF with minimal text, check for embedded image
    if (digitalText.trim().length < 30) {
      const embeddedJpeg = this.extractJpegFromPdf(buffer);
      if (embeddedJpeg) {
        this.logger.log(
          `Scanned PDF detected (${filename}). Extracted embedded page image (${embeddedJpeg.length} bytes) for Grok Vision processing.`,
        );
        return this.scanImage(embeddedJpeg, 'image/jpeg', filename);
      }
    }

    // 4. Call Grok Chat Completion if key configured
    if (this.apiKey) {
      try {
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
            { role: 'user', content: prompt },
          ],
          temperature: 0.1,
          max_tokens: 4096,
        };

        const responseText = await this.callGrokApi(payload);
        const { extractedText, structuredData } = this.parseGrokResponse(responseText);

        return {
          extractedText: extractedText || digitalText,
          structuredData,
          modelUsed: this.chatModel,
          scannedAt: new Date().toISOString(),
        };
      } catch (err) {
        this.logger.warn(
          `Grok PDF processing failed: ${err instanceof Error ? err.message : String(err)}. Falling back to local PDF text extraction.`,
        );
      }
    }

    // 5. Intelligent local extraction from PDF text
    const cleanText =
      digitalText.trim() ||
      `# Document: ${filename}\n[Scanned PDF petition received without digital text layers]`;
    const structuredData = this.heuristicExtraction(cleanText, filename);

    return {
      extractedText: cleanText,
      structuredData,
      modelUsed: this.apiKey
        ? 'pdf-extracted (xAI offline)'
        : 'pdf-extracted (XAI_API_KEY needed)',
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
   * Secondary vision fallback using Groq Llama Vision if configured in environment.
   */
  private async callGroqVision(
    groqKey: string,
    dataUrl: string,
    filename: string,
  ): Promise<GrokScanResult | null> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45000);

    try {
      const prompt = this.buildExtractionPrompt();
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${groqKey}`,
        },
        body: JSON.stringify({
          model: 'llama-3.2-11b-vision-preview',
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: prompt },
                { type: 'image_url', image_url: { url: dataUrl } },
              ],
            },
          ],
          temperature: 0.1,
          max_tokens: 2048,
        }),
        signal: controller.signal,
      });

      if (!res.ok) return null;
      const json = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = json.choices?.[0]?.message?.content;
      if (!content) return null;

      const { extractedText, structuredData } = this.parseGrokResponse(content);
      return {
        extractedText,
        structuredData,
        modelUsed: 'groq-llama-vision-fallback',
        scannedAt: new Date().toISOString(),
      };
    } catch {
      return null;
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
   * Pure Node stream text extraction fallback from PDF streams.
   */
  private extractStreamText(buffer: Buffer): string {
    try {
      const content = buffer.toString('binary');
      const textChunks: string[] = [];
      const streamRegex = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
      let match: RegExpExecArray | null;

      while ((match = streamRegex.exec(content)) !== null) {
        const rawStream = Buffer.from(match[1], 'binary');
        let streamText = '';
        try {
          const decompressed = zlib.inflateSync(rawStream);
          streamText = decompressed.toString('latin1');
        } catch {
          streamText = rawStream.toString('latin1');
        }

        const btEtRegex = /BT([\s\S]*?)ET/g;
        let btMatch: RegExpExecArray | null;
        while ((btMatch = btEtRegex.exec(streamText)) !== null) {
          const block = btMatch[1];
          const tjRegex = /\[(.*?)\]\s*TJ/g;
          let tjMatch: RegExpExecArray | null;
          while ((tjMatch = tjRegex.exec(block)) !== null) {
            const inner = tjMatch[1];
            const innerStrRegex = /\(([^)]*)\)/g;
            let isMatch: RegExpExecArray | null;
            let line = '';
            while ((isMatch = innerStrRegex.exec(inner)) !== null) {
              line += isMatch[1];
            }
            if (line.trim()) textChunks.push(line);
          }
          const strRegex = /\(([^)]*)\)\s*(?:Tj|'|")/g;
          let sMatch: RegExpExecArray | null;
          while ((sMatch = strRegex.exec(block)) !== null) {
            if (sMatch[1].trim()) textChunks.push(sMatch[1]);
          }
        }
      }
      return textChunks.join('\n');
    } catch {
      return '';
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
   * Heuristic extraction of key grievance fields from text or document metadata.
   */
  heuristicExtraction(text: string, filename: string): GrievanceExtractedData {
    const data: GrievanceExtractedData = {
      issueSummary: '',
    };

    // 1. Contact number (10-digit Indian phone)
    const phoneMatch = /(?:(?:\+?91[\s-]?)?[6-9]\d{9})\b/.exec(text);
    if (phoneMatch) {
      data.contactNumber = phoneMatch[0].replace(/\D/g, '').slice(-10);
    }

    // 2. Reference / petition number
    const refMatch =
      /(?:ref(?:erence)?|petition|slip|grievance|complaint|no|s\.?no)[\s.:#/-]+([A-Za-z0-9/-]{3,30})/i.exec(
        text,
      );
    if (refMatch) {
      data.referenceNumber = refMatch[1].trim();
    }

    // 3. Date
    const dateMatch =
      /(?:date[\s.:-]+)?(\d{4}[-/]\d{2}[-/]\d{2}|\d{2}[-/]\d{2}[-/]\d{4})/i.exec(
        text,
      );
    if (dateMatch) {
      const rawDate = dateMatch[1].replace(/\//g, '-');
      if (/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) {
        data.date = rawDate;
      } else {
        const parts = rawDate.split('-');
        if (parts.length === 3) {
          data.date = `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
        }
      }
    }

    // 4. Applicant name
    const nameMatch =
      /(?:applicant|petitioner|complainant|citizen|from|name|sri|smt)[\s.:-]+([A-Za-z\s.]{3,40})/i.exec(
        text,
      );
    if (nameMatch) {
      const clean = nameMatch[1].replace(/[\r\n].*$/, '').trim();
      if (clean.length >= 3 && !/^(the|officer|mandal|department|collector)/i.test(clean)) {
        data.applicantName = clean;
      }
    }

    // If name not in text, infer from filename (e.g. petition_Lakshmi_Rao.pdf)
    if (!data.applicantName && filename) {
      const cleanName = filename
        .replace(/\.[a-z0-9]+$/i, '')
        .replace(/[_-]+/g, ' ')
        .replace(/\b(petition|slip|document|scan|grievance|letter|photo|doc)\b/gi, '')
        .trim();
      if (cleanName.length >= 3 && cleanName.length <= 40) {
        data.applicantName = cleanName;
      }
    }

    // 5. Category detection from keywords
    const lowerText = (text + ' ' + filename).toLowerCase();
    for (const item of CATEGORY_KEYWORDS) {
      if (item.keywords.some((k) => lowerText.includes(k))) {
        data.category = item.category;
        break;
      }
    }
    if (!data.category) {
      data.category = 'Public Grievance';
    }

    // 6. Location detection from Palnadu places
    for (const constituency of PALNADU_CONSTITUENCIES) {
      if (new RegExp(`\\b${constituency}\\b`, 'i').test(text)) {
        data.assemblyConstituency = constituency;
        break;
      }
    }

    for (const mandal of PALNADU_MANDALS) {
      if (new RegExp(`\\b${mandal}\\b`, 'i').test(text)) {
        data.mandal = mandal;
        if (!data.village) data.village = mandal;
        if (!data.assemblyConstituency) data.assemblyConstituency = mandal;
        break;
      }
    }

    // 7. Action requested & summary
    const actionMatch =
      /(?:action(?:\s+to\s+be)?\s+taken|requested|prayer|demand|subject|sub)[\s.:-]+([^\r\n]{10,150})/i.exec(
        text,
      );
    if (actionMatch) {
      data.actionRequested = actionMatch[1].trim();
      data.issueSummary = actionMatch[1].trim();
    } else if (text.trim().length > 0) {
      const firstLine = text.trim().split('\n').filter((l) => l.trim().length > 15)[0];
      data.issueSummary = firstLine ? firstLine.slice(0, 150).trim() : `Petition regarding ${data.category}`;
    } else {
      data.issueSummary = `Grievance petition attached (${filename})`;
    }

    return data;
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
      '  "category": string | null (e.g. Roads & Infrastructure, Irrigation & Water Resources, Revenue & Land Issues, CMRF / Medical Assistance, Agriculture, Housing, Public Grievance, etc.),\n' +
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
          extractedText = content.replace(jsonMatch[0], '').trim();
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
