import { readFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';

export interface KnowledgeDocument {
  id: string;
  title: string;
  content: string;
  keywords: string[];
}

const STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'by',
  'for',
  'from',
  'i',
  'in',
  'is',
  'it',
  'my',
  'of',
  'on',
  'or',
  'that',
  'the',
  'this',
  'to',
  'was',
  'what',
  'with',
]);

export async function loadKnowledge(
  filePath: string,
): Promise<KnowledgeDocument[]> {
  const raw = await readFile(filePath, 'utf8');
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error('Knowledge base must be a JSON array.');
  }
  const documents: KnowledgeDocument[] = [];
  for (const entry of parsed) {
    const document = toDocument(entry);
    if (document) documents.push(document);
  }
  if (!documents.length) {
    throw new Error(`Knowledge base at ${filePath} has no valid documents.`);
  }
  return documents;
}

export function resolveKnowledgePath(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const configured = (env.KNOWLEDGE_BASE_PATH || '').trim();
  if (configured) {
    return isAbsolute(configured)
      ? configured
      : resolve(process.cwd(), configured);
  }
  return resolve(__dirname, 'data/knowledge.json');
}

export function searchKnowledge(
  documents: readonly KnowledgeDocument[],
  query: string,
  options: { topK?: number; minScore?: number } = {},
): KnowledgeDocument[] {
  const topK = options.topK ?? 3;
  const minScore = options.minScore ?? 2;
  const tokens = tokenizeQuery(query);
  const phrase = normalize(query);
  if (!tokens.length && phrase.length < 3) return [];

  return documents
    .map((document) => ({
      document,
      score: scoreDocument(document, tokens, phrase),
    }))
    .filter((match) => match.score >= minScore)
    .sort((left, right) => right.score - left.score)
    .slice(0, topK)
    .map((match) => match.document);
}

function toDocument(value: unknown): KnowledgeDocument | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  if (
    typeof row.id !== 'string' ||
    !row.id.trim() ||
    typeof row.title !== 'string' ||
    !row.title.trim() ||
    typeof row.content !== 'string' ||
    !row.content.trim() ||
    !Array.isArray(row.keywords) ||
    !row.keywords.every(
      (keyword) => typeof keyword === 'string' && keyword.trim(),
    )
  ) {
    return null;
  }
  return {
    id: row.id.trim(),
    title: row.title.trim(),
    content: row.content.trim(),
    keywords: row.keywords.map((keyword) => String(keyword).trim()),
  };
}

function scoreDocument(
  document: KnowledgeDocument,
  tokens: string[],
  phrase: string,
): number {
  const title = new Set(tokenize(document.title));
  const keywords = new Set(
    document.keywords.flatMap((keyword) => tokenize(keyword)),
  );
  const content = new Set(tokenize(document.content));
  let score = 0;
  for (const token of tokens) {
    if (title.has(token)) score += 5;
    if (keywords.has(token)) score += 4;
    if (content.has(token)) score += 1;
  }
  const haystack = `${normalize(document.title)} ${normalize(document.content)}`;
  if (phrase.length >= 3 && haystack.includes(phrase)) score += 6;
  return score;
}

function tokenizeQuery(query: string): string[] {
  const tokens = tokenize(query);
  const useful = tokens.filter((token) => !STOP_WORDS.has(token));
  return useful.length ? useful : tokens;
}

function tokenize(value: string): string[] {
  return [...new Set(normalize(value).split(' ').filter(Boolean))];
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
