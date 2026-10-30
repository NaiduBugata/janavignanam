import json
import logging
import sqlite3
from collections.abc import Sequence
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import UUID

import numpy as np

from app.storage.interfaces import ChunkRecord, VectorStore

logger = logging.getLogger(__name__)


class LocalVectorStore(VectorStore):
    def __init__(self, data_dir: Path) -> None:
        self.data_dir = data_dir
        self.db_path = data_dir / "metadata" / "metadata.sqlite3"
        self.index_path = data_dir / "vectors" / "vectors.npz"
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self.index_path.parent.mkdir(parents=True, exist_ok=True)
        self._initialize()
        self._repair_index()

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.db_path)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        return connection

    def _initialize(self) -> None:
        with self._connect() as connection:
            connection.executescript(
                """
                PRAGMA foreign_keys = ON;
                CREATE TABLE IF NOT EXISTS documents (
                    document_id TEXT PRIMARY KEY,
                    document_name TEXT NOT NULL,
                    original_filename TEXT NOT NULL UNIQUE,
                    chunk_count INTEGER NOT NULL,
                    created_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS chunks (
                    chunk_id TEXT PRIMARY KEY,
                    document_id TEXT NOT NULL REFERENCES documents(document_id) ON DELETE CASCADE,
                    chunk_index INTEGER NOT NULL,
                    content TEXT NOT NULL,
                    metadata TEXT NOT NULL,
                    UNIQUE(document_id, chunk_index)
                );
                """
            )

    def _repair_index(self) -> None:
        ids, vectors = self._load_index()
        if not ids:
            return
        with self._connect() as connection:
            valid_ids = {
                row["chunk_id"] for row in connection.execute("SELECT chunk_id FROM chunks")
            }
        seen: set[str] = set()
        keep: list[int] = []
        for index, chunk_id in enumerate(ids):
            if chunk_id in valid_ids and chunk_id not in seen:
                keep.append(index)
                seen.add(chunk_id)
        if len(keep) == len(ids):
            return
        repaired_ids = [ids[index] for index in keep]
        repaired_vectors = vectors[keep] if keep else np.empty((0, 0), dtype=np.float32)
        self._save_index(repaired_ids, repaired_vectors)
        logger.warning(
            "Repaired local vector index: removed %s orphan/duplicate vectors; total is now %s",
            len(ids) - len(repaired_ids), len(repaired_ids),
        )

    def _load_index(self) -> tuple[list[str], np.ndarray]:
        if not self.index_path.exists():
            return [], np.empty((0, 0), dtype=np.float32)
        with np.load(self.index_path, allow_pickle=False) as data:
            ids = data["ids"].astype(str).tolist()
            vectors = data["vectors"].astype(np.float32)
        return ids, vectors

    def _save_index(self, ids: list[str], vectors: np.ndarray) -> None:
        temporary = self.index_path.with_suffix(".tmp.npz")
        np.savez_compressed(temporary, ids=np.asarray(ids), vectors=vectors.astype(np.float32))
        temporary.replace(self.index_path)

    @staticmethod
    def _normalize_vectors(vectors: np.ndarray) -> np.ndarray:
        vectors = np.asarray(vectors, dtype=np.float32)
        if vectors.ndim != 2 or vectors.shape[0] == 0:
            raise ValueError("Vector index must contain a two-dimensional array")
        if not np.isfinite(vectors).all():
            raise ValueError("Embeddings must contain only finite values")
        norms = np.linalg.norm(vectors, axis=1, keepdims=True)
        if np.any(norms == 0):
            raise ValueError("Embeddings must have non-zero norms")
        return vectors / norms

    def add_document(self, document_id: UUID | str, document_name: str, original_filename: str,
                     chunks: Sequence[ChunkRecord]) -> int:
        if not chunks:
            raise ValueError("Cannot store a document without valid chunks")
        ids, vectors = self._load_index()
        if vectors.size and vectors.shape[1] != chunks[0].embedding.shape[0]:
            raise ValueError("Embedding dimension does not match the persisted vector index")
        existing_document_id: UUID | None = None
        with self._connect() as connection:
            existing = connection.execute(
                "SELECT document_id FROM documents WHERE original_filename = ?",
                (original_filename,),
            ).fetchone()
            if existing:
                existing_document_id = UUID(existing["document_id"])
        if existing_document_id:
            self.delete_document(existing_document_id)
            ids, vectors = self._load_index()
        with self._connect() as connection:
            now = datetime.now(timezone.utc).isoformat()
            connection.execute(
                "INSERT INTO documents VALUES (?, ?, ?, ?, ?)",
                (str(document_id), document_name, original_filename, len(chunks), now),
            )
            for chunk in chunks:
                connection.execute(
                    "INSERT INTO chunks VALUES (?, ?, ?, ?, ?)",
                    (chunk.chunk_id, str(document_id), chunk.chunk_index, chunk.content,
                     json.dumps(chunk.metadata)),
                )
        new_ids = [chunk.chunk_id for chunk in chunks]
        new_vectors = self._normalize_vectors(
            np.vstack([chunk.embedding for chunk in chunks]).astype(np.float32)
        )
        if vectors.size:
            vectors = np.vstack((vectors, new_vectors))
        else:
            vectors = new_vectors
        self._save_index(ids + new_ids, vectors)
        return len(chunks)

    def search_similar(self, embedding: np.ndarray, top_k: int, threshold: float,
                       document_id: UUID | None = None) -> list[ChunkRecord]:
        ids, vectors = self._load_index()
        if not ids or not vectors.size:
            return []
        if vectors.shape[1] != embedding.shape[0]:
            raise ValueError("Query embedding dimension does not match the vector index")
        query = np.asarray(embedding, dtype=np.float32)
        if not np.isfinite(query).all():
            raise ValueError("Query embedding contains NaN or Inf")
        query_norm = np.linalg.norm(query)
        if query_norm == 0:
            raise ValueError("Query embedding has a zero norm")
        vectors = self._normalize_vectors(vectors)
        query = query / query_norm
        scores = vectors @ query
        ranked = np.argsort(scores)[::-1]
        placeholders = ""
        parameters: tuple[Any, ...] = ()
        if document_id:
            placeholders = " AND c.document_id = ?"
            parameters = (str(document_id),)
        with self._connect() as connection:
            rows = connection.execute(
                f"""SELECT c.*, d.document_name FROM chunks c
                    JOIN documents d ON d.document_id = c.document_id
                    WHERE c.chunk_id IN ({','.join('?' for _ in ids)}){placeholders}""",
                tuple(ids) + parameters,
            ).fetchall()
        by_id = {row["chunk_id"]: row for row in rows}
        logger.info(
            "[FAISS]\nIndex type: normalized inner-product (IndexFlatIP equivalent)\nTotal vectors: %s\n"
            "Retrieved IDs: %s\nRaw scores: %s\n\n[FILTERING]\nConfigured threshold: %.4f\n"
            "Chunks before filtering: %s\nScore comparisons: %s",
            len(ids), ids, [round(float(score), 6) for score in scores], threshold, len(ranked),
            [
                {"chunk_id": ids[int(position)], "score": round(float(scores[int(position)]), 6),
                 "passes": bool(scores[int(position)] >= threshold)}
                for position in ranked
            ],
        )
        results: list[ChunkRecord] = []
        for position in ranked:
            chunk_id = ids[int(position)]
            score = float(scores[int(position)])
            row = by_id.get(chunk_id)
            if row is None or score < threshold:
                continue
            results.append(ChunkRecord(
                document_id=UUID(row["document_id"]),
                document_name=row["document_name"],
                chunk_id=row["chunk_id"],
                chunk_index=row["chunk_index"],
                content=row["content"],
                embedding=vectors[int(position)],
                metadata=json.loads(row["metadata"]),
                score=score,
            ))
            if len(results) >= top_k:
                break
        logger.info(
            "Chunks after filtering: %s\n\n[SQLITE]\nRetrieved chunk IDs: %s\nMissing chunk IDs: %s",
            len(results), [result.chunk_id for result in results],
            [chunk_id for chunk_id in ids if chunk_id not in by_id],
        )
        return results

    def delete_document(self, document_id: UUID) -> bool:
        with self._connect() as connection:
            chunk_rows = connection.execute(
                "SELECT chunk_id FROM chunks WHERE document_id = ?", (str(document_id),)
            ).fetchall()
            deleted = connection.execute(
                "DELETE FROM documents WHERE document_id = ?", (str(document_id),)
            ).rowcount
        ids, vectors = self._load_index()
        removed_ids = {row["chunk_id"] for row in chunk_rows}
        if removed_ids:
            remove = {index for index, chunk_id in enumerate(ids) if chunk_id in removed_ids}
            kept_ids = [chunk_id for index, chunk_id in enumerate(ids) if index not in remove]
            kept_vectors = np.asarray([vector for index, vector in enumerate(vectors) if index not in remove])
            if not kept_ids:
                kept_vectors = np.empty((0, 0), dtype=np.float32)
            self._save_index(kept_ids, kept_vectors)
        return bool(deleted)

    def get_documents(self) -> list[dict[str, Any]]:
        with self._connect() as connection:
            rows = connection.execute("SELECT * FROM documents ORDER BY created_at DESC").fetchall()
        return [dict(row) for row in rows]

    def health_check(self) -> dict[str, Any]:
        with self._connect() as connection:
            count = connection.execute("SELECT COUNT(*) FROM chunks").fetchone()[0]
        return {"status": "ok", "indexed_chunks": count}
