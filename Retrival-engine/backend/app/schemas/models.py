from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, Field


class DocumentResponse(BaseModel):
    document_id: str
    document_name: str
    original_filename: str
    chunk_count: int
    created_at: datetime


class SourceReference(BaseModel):
    document_id: str
    document_name: str
    chunk_id: str
    chunk_index: int
    score: float
    content: str


class QueryRequest(BaseModel):
    question: str = Field(min_length=1, max_length=4000)
    top_k: int | None = Field(default=None, ge=1, le=20)
    document_id: str | None = None


class QueryResponse(BaseModel):
    query_id: UUID
    answer: str
    sources: list[SourceReference]
    has_context: bool


class HealthResponse(BaseModel):
    status: str
    embedding_model: str
    vector_store: str
    groq_configured: bool
    indexed_chunks: int
    read_only: bool = False
    vector_available: bool = False
    semantic_retrieval: bool = False


class RetrievalResult(BaseModel):
    document_id: str
    document_name: str
    chunk_id: str
    chunk_index: int
    content: str
    score: float
    metadata: dict[str, Any] = {}
