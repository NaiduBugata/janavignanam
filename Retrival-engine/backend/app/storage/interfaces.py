from abc import ABC, abstractmethod
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any
from uuid import UUID

import numpy as np


@dataclass(frozen=True)
class ChunkRecord:
    document_id: UUID | str
    document_name: str
    chunk_id: str
    chunk_index: int
    content: str
    embedding: np.ndarray
    metadata: dict[str, Any]
    score: float = 0.0


class VectorStore(ABC):
    @abstractmethod
    def add_document(self, document_id: UUID | str, document_name: str, original_filename: str,
                     chunks: Sequence[ChunkRecord]) -> int:
        raise NotImplementedError

    @abstractmethod
    def search_similar(self, embedding: np.ndarray, top_k: int,
                       threshold: float, document_id: UUID | str | None = None) -> list[ChunkRecord]:
        raise NotImplementedError

    @abstractmethod
    def delete_document(self, document_id: UUID) -> bool:
        raise NotImplementedError

    @abstractmethod
    def get_documents(self) -> list[dict[str, Any]]:
        raise NotImplementedError

    @abstractmethod
    def health_check(self) -> dict[str, Any]:
        raise NotImplementedError
