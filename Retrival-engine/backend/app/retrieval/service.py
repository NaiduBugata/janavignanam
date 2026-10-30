import logging
from uuid import UUID

import numpy as np

from app.embeddings.service import EmbeddingService
from app.schemas.models import RetrievalResult
from app.storage.interfaces import VectorStore

logger = logging.getLogger(__name__)


class RetrievalService:
    def __init__(self, store: VectorStore, embeddings: EmbeddingService,
                 top_k: int, threshold: float) -> None:
        self.store = store
        self.embeddings = embeddings
        self.top_k = top_k
        self.threshold = threshold

    def retrieve(self, question: str, top_k: int | None = None,
                 document_id: UUID | str | None = None) -> list[RetrievalResult]:
        normalized = " ".join(question.split())
        if not normalized:
            raise ValueError("Question cannot be empty")
        query_embedding = self.embeddings.embed(normalized)
        logger.info(
            "[QUERY]\nQuestion: %s\nDocument filter: %s\n\n[EMBEDDING]\nDimension: %s\nNorm: %.6f\nContains NaN/Inf: %s",
            normalized,
            document_id or "none",
            query_embedding.shape[0],
            float(np.linalg.norm(query_embedding)),
            not np.isfinite(query_embedding).all(),
        )
        if hasattr(self.store, "search"):
            results = self.store.search(normalized, top_k or self.top_k, document_id)
        else:
            results = self.store.search_similar(
                query_embedding, top_k or self.top_k, self.threshold, document_id,
            )
        return [
            RetrievalResult(
                document_id=str(result.document_id),
                document_name=result.document_name,
                chunk_id=result.chunk_id,
                chunk_index=result.chunk_index,
                content=result.content,
                score=result.score,
                metadata=result.metadata,
            )
            for result in results
        ]
