import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes, randomUUID } from 'node:crypto';
import { DatabaseService } from '../database/database.service';
import { discoverGroqApiKeys } from '../ai/groq-keys';
import { QueryRagDto, RagResponse, SourceReference } from './rag.dto';

const SYNONYMS: Record<string, string[]> = {
  sp: ['sp', 'superintendent of police', 'ఎస్పీ', 'పోలీస్', 'police'],
  mp: ['mp', 'member of parliament', 'ఎంపీ', 'కృష్ణదేవరాయలు', 'lavu', 'devarayalu', 'parliament'],
  mla: ['mla', 'శాసనసభ్యులు', 'ఎమ్మెల్యే', 'గోపిరెడ్డి', 'మహమ్మద్'],
  ro: ['ro', 'revenue officer', 'water plant', 'రివర్స్ ఆస్మాసిస్', 'తాగునీరు', 'drinking water'],
  si: ['si', 'sub inspector', 'ఎస్ఐ', 'పోలీస్', 'police'],
  ci: ['ci', 'circle inspector', 'సిఐ', 'పోలీస్', 'police'],
  cm: ['cm', 'chief minister', 'ముఖ్యమంత్రి', 'సిఎం', 'చంద్రబాబు', 'జగన్'],
  cmrf: ['cmrf', 'relief fund', 'ముఖ్యమంత్రి సహాయనిధి', 'medical assistance', 'వైద్య సహాయం'],
  ttd: ['ttd', 'తిరుమల', 'తిరుపతి', 'దేవస్థానం', 'దర్శనం', 'recommendation letter'],
  water: ['water', 'drinking water', 'నీరు', 'నీటి', 'తాగునీరు', 'పైప్‌లైన్', 'బోరు', 'ట్యాంకర్', 'డ్రింకింగ్'],
  road: ['road', 'roads', 'రోడ్డు', 'రోడ్లు', 'రహదారి', 'రహదారులు', 'r&b', 'r and b'],
  roads: ['road', 'roads', 'రోడ్డు', 'రోడ్లు', 'రహదారి', 'రహదారులు', 'r&b'],
  hospital: ['hospital', 'health', 'ఆసుపత్రి', 'వైద్యం', 'వైద్యులు', 'ఆరోగ్యం', 'యశోద', 'క్యాన్సర్'],
  health: ['hospital', 'health', 'ఆసుపత్రి', 'వైద్యం', 'వైద్యులు', 'ఆరోగ్యం', 'యశోద', 'క్యాన్సర్'],
  cancer: ['cancer', 'క్యాన్సర్', 'యశోద', 'oncology', 'ఆంకాలజీ', 'hospital'],
  yashoda: ['yashoda', 'యశోద', 'hospital', 'క్యాన్సర్'],
  school: ['school', 'education', 'పాఠశాల', 'బడి', 'విద్యార్థి', 'విద్య', 'ఫీజు'],
  education: ['school', 'education', 'పాఠశాల', 'బడి', 'విద్యార్థి', 'విద్య', 'ఫీజు'],
  pension: ['pension', 'పెన్షన్', 'పింఛన్', 'వృద్ధాప్య'],
  theft: ['theft', 'crime', 'robbery', 'దొంగతనం', 'చోరీ', 'దొంగలు', 'బంగారం', 'వెండి', 'gold', 'silver', 'పోలీస్', 'police'],
  crime: ['theft', 'crime', 'robbery', 'దొంగతనం', 'చోరీ', 'దొంగలు', 'బంగారం', 'వెండి', 'gold', 'silver', 'పోలీస్', 'police'],
  gold: ['gold', 'బంగారం', 'నగలు'],
  silver: ['silver', 'వెండి'],
  farmer: ['farmer', 'agriculture', 'crop', 'రైతు', 'వ్యవసాయం', 'పంట', 'మిర్చి', 'పత్తి'],
  agriculture: ['farmer', 'agriculture', 'crop', 'రైతు', 'వ్యవసాయం', 'పంట', 'మిర్చి', 'పత్తి'],
  drainage: ['drainage', 'మురుగు', 'కాలువ', 'డ్రైనేజీ', 'చెత్త', 'పారిశుధ్యం', 'sanitation'],
  sanitation: ['drainage', 'మురుగు', 'కాలువ', 'డ్రైనేజీ', 'చెత్త', 'పారిశుధ్యం', 'sanitation'],
  power: ['power', 'electricity', 'current', 'కరెంట్', 'విద్యుత్', 'ట్రాన్స్‌ఫార్మర్'],
  electricity: ['power', 'electricity', 'current', 'కరెంట్', 'విద్యుత్', 'ట్రాన్స్‌ఫార్మర్'],
  current: ['power', 'electricity', 'current', 'కరెంట్', 'విద్యుత్', 'ట్రాన్స్‌ఫార్మర్'],
  bus: ['bus', 'rtc', 'apsrtc', 'బస్సు', 'ఆర్టీసీ', 'పల్లెవెలుగు'],
  dosa: ['dosa', 'tiffin', 'టిఫిన్', 'దోశ', 'హోటల్'],
  chirala: ['chirala', 'చీరాల', 'bus', 'పల్లెవెలుగు'],
  apuwj: ['apuwj', 'journalists', 'జర్నలిస్ట్', 'జర్నలిస్టులు', 'press club'],
  press: ['apuwj', 'journalists', 'జర్నలిస్ట్', 'జర్నలిస్టులు', 'press club'],
};

@Injectable()
export class RagService {
  private readonly logger = new Logger(RagService.name);
  private readonly retrievalUrl: string;

  constructor(
    private readonly config: ConfigService,
    private readonly db: DatabaseService,
  ) {
    this.retrievalUrl =
      this.config.get<string>('RETRIEVAL_ENGINE_URL') ||
      process.env.RETRIEVAL_ENGINE_URL ||
      'http://127.0.0.1:8000';
  }

  async checkPythonEngineHealth(): Promise<{
    available: boolean;
    data?: Record<string, unknown>;
  }> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 1500);
      const res = await fetch(`${this.retrievalUrl}/api/health`, {
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (res.ok) {
        const data = (await res.json()) as Record<string, unknown>;
        return { available: true, data };
      }
      return { available: false };
    } catch {
      return { available: false };
    }
  }

  async query(dto: QueryRagDto): Promise<RagResponse> {
    // 1. If Python Retrieval Engine is active, query it first
    const pythonHealth = await this.checkPythonEngineHealth();
    if (pythonHealth.available) {
      try {
        const controller = new AbortController();
        const timeoutMs = 25000;
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        const res = await fetch(`${this.retrievalUrl}/api/rag/query`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(dto),
          signal: controller.signal,
        });
        clearTimeout(timer);
        if (res.ok) {
          const payload = (await res.json()) as {
            query_id?: string;
            answer: string;
            sources?: SourceReference[];
            has_context?: boolean;
          };
          if (payload.sources && payload.sources.length > 0) {
            return {
              query_id: payload.query_id || randomUUID(),
              answer: payload.answer,
              sources: payload.sources || [],
              has_context: payload.has_context ?? true,
              engine: 'python-rag',
            };
          }
        }
      } catch (err) {
        this.logger.warn(`Python RAG query error: ${err}`);
      }
    }

    // 2. High-precision native constituency intelligence search
    return this.nativeConstituencyQuery(dto.question);
  }

  async getDocuments(): Promise<Array<Record<string, unknown>>> {
    const pythonHealth = await this.checkPythonEngineHealth();
    if (pythonHealth.available) {
      try {
        const res = await fetch(`${this.retrievalUrl}/api/documents`);
        if (res.ok) {
          return (await res.json()) as Array<Record<string, unknown>>;
        }
      } catch {
        // Fall back
      }
    }
    return [
      {
        document_id: 'palnadu-constituency-db',
        document_name: 'Palnadu Parliamentary Constituency Master Intelligence & News DB',
        original_filename: 'palnadu_master.db',
        chunk_count: 50,
        created_at: new Date().toISOString(),
      },
    ];
  }

  private extractSearchTokens(rawQuery: string): {
    cleanQuery: string;
    tokens: string[];
    expanded: string[];
    isShort: boolean;
  } {
    const cleanQuery = rawQuery.trim().toLowerCase();
    
    // Split into tokens, preserving small words (length >= 2, or Telugu >= 1)
    const rawTokens = cleanQuery
      .split(/[\s,.;:!?/\\(){}[\]"'`~@#$%^&*+=<>|]+/)
      .map((t) => t.trim())
      .filter((t) => {
        if (!t) return false;
        // Telugu Unicode block
        if (/[\u0C00-\u0C7F]/.test(t)) return true;
        // Keep alphanumeric tokens of length >= 2 (e.g. SP, MP, RO, SI, CI, CM)
        return t.length >= 2;
      });

    const tokens = rawTokens.length > 0 ? rawTokens : [cleanQuery];
    const expandedSet = new Set<string>(tokens);

    for (const token of tokens) {
      if (SYNONYMS[token]) {
        for (const syn of SYNONYMS[token]) {
          expandedSet.add(syn.toLowerCase());
        }
      }
      for (const [key, synList] of Object.entries(SYNONYMS)) {
        if (token.length >= 3 && (key.startsWith(token) || token.startsWith(key))) {
          for (const syn of synList) expandedSet.add(syn.toLowerCase());
        }
      }
    }

    return {
      cleanQuery,
      tokens,
      expanded: Array.from(expandedSet),
      isShort: tokens.length <= 2,
    };
  }

  private async nativeConstituencyQuery(question: string): Promise<RagResponse> {
    const { cleanQuery, tokens, expanded, isShort } = this.extractSearchTokens(question);
    const candidateMap = new Map<string, { doc: Record<string, unknown>; collection: string; score: number }>();

    try {
      await this.db.ensureConnected();

      // Step 1: Direct SQL ILIKE search across entire Neon documents table for exact small words and tokens
      const searchTerms = [cleanQuery, ...tokens.slice(0, 3)].filter((t) => t.length >= 2);
      for (const term of searchTerms) {
        const rows = await this.db.query<{ doc_id: string; collection: string; doc: Record<string, unknown> }>(
          `SELECT doc_id, collection, doc 
           FROM mediasphere.documents 
           WHERE collection IN ('articles', 'jv_records') 
             AND doc::text ILIKE $1 
           LIMIT 50`,
          [`%${term}%`],
        );
        for (const r of rows) {
          const docId = String(r.doc_id || r.doc?.id || r.doc?._id || randomUUID());
          if (!candidateMap.has(docId)) {
            candidateMap.set(docId, { doc: r.doc, collection: r.collection, score: 35 });
          } else {
            const cur = candidateMap.get(docId)!;
            cur.score += 20;
          }
        }
      }

      // Step 2: Ingest recent articles & records to ensure fresh recency scoring
      const recentArticles = await this.db
        .articles()
        .find({})
        .limit(150)
        .toArray();
      for (const a of recentArticles) {
        const docId = String(a.id || a._id || randomUUID());
        if (!candidateMap.has(docId)) {
          candidateMap.set(docId, { doc: a, collection: 'articles', score: 0 });
        }
      }

      const recentRecords = await this.db
        .collection('jv_records')
        .find({})
        .limit(150)
        .toArray();
      for (const r of recentRecords) {
        const docId = String(r.id || r._id || randomUUID());
        if (!candidateMap.has(docId)) {
          candidateMap.set(docId, { doc: r, collection: 'jv_records', score: 0 });
        }
      }
    } catch (err) {
      this.logger.warn(`Could not load records for native RAG: ${err}`);
    }

    // Step 3: Granular multi-factor field relevance scoring
    const scoredList: Array<{ doc: Record<string, unknown>; collection: string; finalScore: number }> = [];

    for (const [, item] of candidateMap.entries()) {
      const doc = item.doc;

      const title = String(doc.title || doc.fullName || '').toLowerCase();
      const summary = String(doc.summary || doc.detail || '').toLowerCase();
      const content = String(doc.content || doc.raw_content || doc.actionToBeTaken || doc.actionTaken || '').toLowerCase();
      const place = String(doc.assembly_segment || doc.assemblyConstituency || doc.village || doc.mandal || doc.division || '').toLowerCase();
      const category = String(doc.category || doc.sub_category || (Array.isArray(doc.categories) ? doc.categories.join(' ') : '')).toLowerCase();
      const officerOrDept = String(doc.assignedOfficer || doc.followUpDepartment || doc.referenceName || doc.authority || '').toLowerCase();
      const remarks = String(doc.progressRemarks || '').toLowerCase();

      let score = item.score; // Base score from SQL match

      // 1. Exact phrase match
      if (cleanQuery.length >= 2) {
        if (title.includes(cleanQuery)) score += 50;
        if (summary.includes(cleanQuery)) score += 30;
        if (place.includes(cleanQuery)) score += 25;
        if (category.includes(cleanQuery)) score += 25;
        if (officerOrDept.includes(cleanQuery)) score += 30;
        if (content.includes(cleanQuery)) score += 15;
      }

      // 2. Token matches (exact & sub-word prefix)
      for (const token of tokens) {
        // Title match
        if (title.includes(token)) {
          score += 35;
          // Exact word match for alphanumeric tokens
          if (/^[\w]+$/i.test(token)) {
            try {
              const regex = new RegExp(`\\b${token}\\b`, 'i');
              if (regex.test(title)) score += 20;
            } catch {
              // Fallback
            }
          }
        }
        // Location / Assembly match
        if (place.includes(token)) score += 25;
        // Category match
        if (category.includes(token)) score += 25;
        // Officer / Department match
        if (officerOrDept.includes(token)) score += 30;
        // Summary match
        if (summary.includes(token)) score += 20;
        // Remarks / Content match
        if (remarks.includes(token)) score += 20;
        if (content.includes(token)) score += 10;
      }

      // 3. Synonym / Expanded terms match
      for (const syn of expanded) {
        if (!tokens.includes(syn)) {
          if (title.includes(syn)) score += 20;
          if (summary.includes(syn) || content.includes(syn)) score += 12;
          if (place.includes(syn) || category.includes(syn)) score += 15;
        }
      }

      if (score > 0) {
        scoredList.push({ doc, collection: item.collection, finalScore: score });
      }
    }

    // Sort by highest score first
    scoredList.sort((a, b) => b.finalScore - a.finalScore);

    const topCandidates = scoredList.slice(0, 6);
    const sources: SourceReference[] = [];

    topCandidates.forEach((item, idx) => {
      const doc = item.doc;
      const isArt = item.collection === 'articles';
      const name = isArt
        ? String(doc.title || 'Constituency News Article')
        : `${String(doc.title || doc.fullName || 'Constituency Record')} (${String(doc.status || 'Active')})`;

      let excerpt = '';
      if (isArt) {
        excerpt = String(doc.summary || doc.content || doc.snippet || '').slice(0, 650);
      } else {
        excerpt = [
          `Record: ${String(doc.title || doc.fullName || '')}`,
          doc.status ? `Status: ${doc.status}` : '',
          doc.followUpDepartment ? `Department: ${doc.followUpDepartment}` : '',
          [doc.village, doc.mandal, doc.assemblyConstituency].filter(Boolean).join(', ')
            ? `Location: ${[doc.village, doc.mandal, doc.assemblyConstituency].filter(Boolean).join(', ')}`
            : '',
          doc.detail ? `Details: ${doc.detail}` : '',
          doc.actionToBeTaken || doc.actionTaken ? `Action: ${doc.actionToBeTaken || doc.actionTaken}` : '',
          doc.progressRemarks ? `Remarks: ${doc.progressRemarks}` : '',
        ]
          .filter(Boolean)
          .join('. ');
      }

      const matchRatio = Math.min(0.99, Math.max(0.60, 0.50 + (item.finalScore / 180) * 0.49));

      sources.push({
        document_id: String(doc.id || doc._id || doc.doc_id || randomBytes(4).toString('hex')),
        document_name: name,
        chunk_id: `chunk_${idx + 1}`,
        chunk_index: idx + 1,
        score: matchRatio,
        content: excerpt,
      });
    });

    const hasContext = sources.length > 0;
    const answer = await this.generateLlmAnswer(question, sources, isShort);

    return {
      query_id: randomUUID(),
      answer,
      sources,
      has_context: hasContext,
      engine: 'native-rag',
    };
  }

  private async generateLlmAnswer(
    question: string,
    sources: SourceReference[],
    isShort: boolean,
  ): Promise<string> {
    const keys = discoverGroqApiKeys(process.env);
    if (!keys.length || !sources.length) {
      if (!sources.length) {
        return (
          `No specific constituency records or news articles found matching "${question}".\n\n` +
          `Tip: Try searching for key terms like "SP", "police", "CMRF", "water", "roads", "Chilakaluripet", ` +
          `or specific mandals and department names.`
        );
      }
      return (
        `Found ${sources.length} matching constituency records for "${question}":\n\n` +
        sources
          .map((s, i) => `${i + 1}. **${s.document_name}** (${(s.score * 100).toFixed(0)}% match):\n${s.content.slice(0, 200)}...`)
          .join('\n\n')
      );
    }

    const contextText = sources
      .map(
        (s, i) =>
          `[Source ${i + 1}: ${s.document_name} | Match Relevance: ${(s.score * 100).toFixed(1)}%]\n${s.content}`,
      )
      .join('\n\n');

    let promptDirective = '';
    if (isShort) {
      promptDirective =
        `The user entered a specific topic/keyword query: "${question}".\n` +
        `Provide an executive briefing tailored for Sri. Lavu Sri Krishna Devarayalu Sir (MP Narasaraopet).\n` +
        `Summarize all verified occurrences, departments, ongoing actions, key personnel, and statuses found in the retrieved sources for "${question}".`;
    } else {
      promptDirective =
        `Answer the MP's question thoroughly and factually based strictly on the retrieved constituency context below.\n` +
        `Question: ${question}`;
    }

    const prompt =
      `You are the dedicated AI Intelligence Assistant for Sri. Lavu Sri Krishna Devarayalu (Member of Parliament, Narasaraopet / Palnadu).\n\n` +
      `${promptDirective}\n\n` +
      `Retrieved Verified Context:\n${contextText}\n\n` +
      `Guidelines:\n` +
      `- Provide clear, authoritative facts citing numbers, locations, and status.\n` +
      `- Use bullet points for high readability.\n` +
      `- If any aspect is unconfirmed in the sources, note it transparently.\n` +
      `- Tone: Executive, professional, and respectful.`;

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 12000);
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${keys[0]}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
          temperature: 0.15,
          max_tokens: 650,
          messages: [{ role: 'user', content: prompt }],
        }),
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (res.ok) {
        const body = (await res.json()) as {
          choices?: Array<{ message?: { content?: string } }>;
        };
        const text = body.choices?.[0]?.message?.content;
        if (text) return text.trim();
      }
    } catch (err) {
      this.logger.warn(`Groq completion error in RAG service: ${err}`);
    }

    return (
      `Verified intelligence for "${question}" (${sources.length} sources matched):\n\n` +
      sources.map((s) => `• **${s.document_name}**: ${s.content.slice(0, 180)}...`).join('\n')
    );
  }
}
