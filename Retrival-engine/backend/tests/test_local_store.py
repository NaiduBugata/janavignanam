from uuid import uuid4

import numpy as np

from app.storage.interfaces import ChunkRecord
from app.storage.local_store import LocalVectorStore


def test_local_store_persists_search_and_delete(tmp_path) -> None:
    store = LocalVectorStore(tmp_path)
    document_id = uuid4()
    chunks = [
        ChunkRecord(document_id, "notes.docx", f"{document_id}:0", 0, "alpha", np.array([1.0, 0.0]), {}),
        ChunkRecord(document_id, "notes.docx", f"{document_id}:1", 1, "beta", np.array([0.0, 1.0]), {}),
    ]
    assert store.add_document(document_id, "notes.docx", "notes.docx", chunks) == 2
    result = store.search_similar(np.array([1.0, 0.0]), 1, 0.5)
    assert result[0].content == "alpha"
    assert result[0].score == 1.0
    assert store.delete_document(document_id)
    assert store.health_check()["indexed_chunks"] == 0


def test_replacing_document_removes_stale_vectors(tmp_path) -> None:
    store = LocalVectorStore(tmp_path)
    old_document_id = uuid4()
    old_chunk = ChunkRecord(
        old_document_id, "notes.docx", f"{old_document_id}:0", 0,
        "old", np.array([1.0, 0.0]), {},
    )
    store.add_document(old_document_id, "notes.docx", "notes.docx", [old_chunk])

    new_document_id = uuid4()
    new_chunk = ChunkRecord(
        new_document_id, "notes.docx", f"{new_document_id}:0", 0,
        "new", np.array([0.0, 2.0]), {},
    )
    store.add_document(new_document_id, "notes.docx", "notes.docx", [new_chunk])

    results = store.search_similar(np.array([1.0, 0.0]), 5, -1.0)
    assert [result.content for result in results] == ["new"]
