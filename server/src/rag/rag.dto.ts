import { IsOptional, IsString, MaxLength, MinLength, IsInt, Min, Max } from 'class-validator';

export class QueryRagDto {
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  question: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  top_k?: number;

  @IsOptional()
  @IsString()
  document_id?: string;
}

export interface SourceReference {
  document_id: string;
  document_name: string;
  chunk_id: string;
  chunk_index: number;
  score: number;
  content: string;
}

export interface RagResponse {
  query_id: string;
  answer: string;
  sources: SourceReference[];
  has_context: boolean;
  engine: 'python-rag' | 'native-rag';
}
