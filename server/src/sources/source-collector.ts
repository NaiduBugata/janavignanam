export type SourceName = 'lokal' | 'youtube' | 'sakshi';

export interface PipelineContext {
  runId: string;
}

export interface CollectedArticle {
  post_id: string;
  source: SourceName;
  title: string;
  content?: string;
  source_url?: string;
  created_on?: string;
  thumbnail?: string;
  assembly_segment?: string | null;
}

export interface SourceCollectionResult {
  source: SourceName;
  status: 'success' | 'failed' | 'skipped';
  startedAt: string;
  completedAt: string;
  durationMs: number;
  itemsFound: number;
  itemsNew: number;
  itemsDuplicate: number;
  itemsFailed: number;
  errors: string[];
  articles: CollectedArticle[];
  exitCode: number;
}

export interface SourceCollector {
  collect(context: PipelineContext): Promise<SourceCollectionResult>;
}
