from pathlib import Path
from uuid import uuid4

import numpy as np

from app.retrieval.service import RetrievalService
from app.storage.interfaces import ChunkRecord
from app.storage.local_store import LocalVectorStore


class DeterministicEmbeddings:
    dimension = 7

    def __init__(self) -> None:
        self.calls: list[str] = []

    def embed(self, text: str) -> np.ndarray:
        self.calls.append(text)
        vector = np.zeros(self.dimension, dtype=np.float32)
        vector[len(self.calls) - 1] = 1.0
        return vector


def test_seven_independent_questions_survive_restart(tmp_path: Path) -> None:
    document_id = uuid4()
    store = LocalVectorStore(tmp_path)
    chunks = [
        ChunkRecord(
            document_id, "knowledge.docx", f"{document_id}:{index}", index,
            f"Answer for topic {index}", np.eye(7, dtype=np.float32)[index], {},
        )
        for index in range(7)
    ]
    store.add_document(document_id, "knowledge.docx", "knowledge.docx", chunks)

    embeddings = DeterministicEmbeddings()
    retrieval = RetrievalService(store, embeddings, top_k=1, threshold=0.35)
    for index in range(7):
        results = retrieval.retrieve(f"question {index}")
        assert len(results) == 1
        assert results[0].chunk_index == index

    restarted_store = LocalVectorStore(tmp_path)
    restarted_embeddings = DeterministicEmbeddings()
    restarted_retrieval = RetrievalService(restarted_store, restarted_embeddings, 1, 0.35)
    for index in range(7):
        results = restarted_retrieval.retrieve(f"question {index}")
        assert len(results) == 1
        assert results[0].chunk_index == index
    assert restarted_store.health_check()["indexed_chunks"] == 7
