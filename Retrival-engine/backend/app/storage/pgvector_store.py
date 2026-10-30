import json
import logging
from collections.abc import Sequence
from datetime import datetime, timezone
from typing import Any
from uuid import UUID

import numpy as np
from psycopg_pool import ConnectionPool

from app.storage.interfaces import ChunkRecord, VectorStore

logger = logging.getLogger(__name__)


class PgVectorStore(VectorStore):
    """Writable target store. It never uses the Neon connection."""

    def __init__(self, database_url: str, dimension: int, min_size: int = 1,
                 max_size: int = 8) -> None:
        if not database_url:
            raise RuntimeError("PGVECTOR_DATABASE_URL is required for pgvector mode")
        self.dimension = dimension
        self.pool = ConnectionPool(
            conninfo=database_url,
            min_size=min_size,
            max_size=max_size,
            open=True,
            timeout=15,
        )

    def close(self) -> None:
        self.pool.close()

    @staticmethod
    def _vector_literal(vector: np.ndarray) -> str:
        values = np.asarray(vector, dtype=np.float32)
        if values.ndim != 1 or not np.isfinite(values).all():
            raise ValueError("Embedding must be a finite one-dimensional vector")
        return "[" + ",".join(str(float(value)) for value in values) + "]"

    def ensure_schema(self) -> None:
        with self.pool.connection() as connection:
            with connection.cursor() as cursor:
                cursor.execute("CREATE EXTENSION IF NOT EXISTS vector")
                cursor.execute(
                    f"""CREATE TABLE IF NOT EXISTS rag_embeddings (
                        chunk_id TEXT PRIMARY KEY,
                        source_document_id TEXT NOT NULL,
                        document_name TEXT NOT NULL,
                        chunk_index INTEGER NOT NULL,
                        content TEXT NOT NULL,
                        metadata JSONB NOT NULL DEFAULT '{{}}'::jsonb,
                        embedding vector({self.dimension}) NOT NULL,
                        source_updated_at TIMESTAMPTZ,
                        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                        UNIQUE(source_document_id, chunk_index)
                    )"""
                )
                cursor.execute(
                    "CREATE INDEX IF NOT EXISTS rag_embeddings_embedding_idx "
                    "ON rag_embeddings USING hnsw (embedding vector_cosine_ops)"
                )

    def upsert_chunks(self, chunks: Sequence[ChunkRecord],
                      source_updated_at: datetime | None = None) -> int:
        if not chunks:
            return 0
        with self.pool.connection() as connection:
            with connection.cursor() as cursor:
                for chunk in chunks:
                    if chunk.embedding.shape[0] != self.dimension:
                        raise ValueError("Embedding dimension does not match PGVector target")
                    cursor.execute(
                        """INSERT INTO rag_embeddings
                           (chunk_id, source_document_id, document_name, chunk_index,
                            content, metadata, embedding, source_updated_at)
                           VALUES (%s, %s, %s, %s, %s, %s::jsonb, %s::vector, %s)
                           ON CONFLICT (chunk_id) DO UPDATE SET
                             document_name = EXCLUDED.document_name,
                             chunk_index = EXCLUDED.chunk_index,
                             content = EXCLUDED.content,
                             metadata = EXCLUDED.metadata,
                             embedding = EXCLUDED.embedding,
                             source_updated_at = EXCLUDED.source_updated_at""",
                        (
                            chunk.chunk_id, str(chunk.document_id), chunk.document_name,
                            chunk.chunk_index, chunk.content,
                            json.dumps(chunk.metadata),
                            self._vector_literal(chunk.embedding), source_updated_at,
                        ),
                    )
        return len(chunks)

    def add_document(self, document_id: UUID | str, document_name: str,
                     original_filename: str, chunks: Sequence[ChunkRecord]) -> int:
        return self.replace_document_chunks(document_id, chunks)

    def replace_document_chunks(self, document_id: UUID | str,
                                chunks: Sequence[ChunkRecord],
                                source_updated_at: datetime | None = None) -> int:
        with self.pool.connection() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    "DELETE FROM rag_embeddings WHERE source_document_id = %s",
                    (str(document_id),),
                )
                for chunk in chunks:
                    if chunk.embedding.shape[0] != self.dimension:
                        raise ValueError("Embedding dimension does not match PGVector target")
                    cursor.execute(
                        """INSERT INTO rag_embeddings
                           (chunk_id, source_document_id, document_name, chunk_index,
                            content, metadata, embedding, source_updated_at)
                           VALUES (%s, %s, %s, %s, %s, %s::jsonb, %s::vector, %s)
                           ON CONFLICT (chunk_id) DO UPDATE SET
                             document_name = EXCLUDED.document_name,
                             chunk_index = EXCLUDED.chunk_index,
                             content = EXCLUDED.content,
                             metadata = EXCLUDED.metadata,
                             embedding = EXCLUDED.embedding,
                             source_updated_at = EXCLUDED.source_updated_at""",
                        (
                            chunk.chunk_id, str(chunk.document_id), chunk.document_name,
                            chunk.chunk_index, chunk.content,
                            json.dumps(chunk.metadata),
                            self._vector_literal(chunk.embedding), source_updated_at,
                        ),
                    )
        return len(chunks)

    def search_similar(self, embedding: np.ndarray, top_k: int, threshold: float,
                       document_id: UUID | str | None = None) -> list[ChunkRecord]:
        vector = self._vector_literal(embedding)
        filters = []
        filter_parameters: list[Any] = []
        if document_id is not None:
            filters.append("source_document_id = %s")
            filter_parameters.append(str(document_id))
        where = f"WHERE {' AND '.join(filters)}" if filters else ""
        parameters = [vector, *filter_parameters, vector, max(top_k, 20)]
        with self.pool.connection() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    f"""SELECT chunk_id, source_document_id, document_name, chunk_index,
                               content, metadata,
                               1 - (embedding <=> %s::vector) AS score
                        FROM rag_embeddings
                        {where}
                        ORDER BY embedding <=> %s::vector
                        LIMIT %s""",
                    parameters,
                )
                rows = cursor.fetchall()
        logger.info(
            "[FAISS]\nIndex type: PGVector cosine distance\nTotal vectors: %s\n"
            "Retrieved IDs: %s\nRaw scores: %s\n[FILTERING]\n"
            "Configured threshold: %.3f\nChunks before filtering: %s",
            self._count_vectors(),
            [row[0] for row in rows],
            [float(row[6]) for row in rows],
            threshold,
            len(rows),
        )
        filtered = [row for row in rows if float(row[6]) >= threshold]
        logger.info("Chunks after filtering: %s", len(filtered))
        return [
            ChunkRecord(
                document_id=row[1], document_name=row[2], chunk_id=row[0],
                chunk_index=row[3], content=row[4], embedding=np.zeros(self.dimension),
                metadata=row[5] or {}, score=float(row[6]),
            )
            for row in filtered[:top_k]
        ]

    def _count_vectors(self) -> int:
        with self.pool.connection() as connection:
            with connection.cursor() as cursor:
                cursor.execute("SELECT count(*) FROM rag_embeddings")
                return int(cursor.fetchone()[0])

    def delete_document(self, document_id: UUID) -> bool:
        with self.pool.connection() as connection:
            with connection.cursor() as cursor:
                cursor.execute("DELETE FROM rag_embeddings WHERE source_document_id = %s",
                               (str(document_id),))
                return cursor.rowcount > 0

    def get_documents(self) -> list[dict[str, Any]]:
        with self.pool.connection() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    "SELECT source_document_id, max(document_name), count(*), "
                    "min(created_at) FROM rag_embeddings GROUP BY source_document_id "
                    "ORDER BY min(created_at) DESC"
                )
                rows = cursor.fetchall()
        return [
            {
                "document_id": row[0], "document_name": row[1],
                "original_filename": row[1], "chunk_count": row[2],
                "created_at": row[3] or datetime.now(timezone.utc),
            }
            for row in rows
        ]

    def health_check(self) -> dict[str, Any]:
        with self.pool.connection() as connection:
            with connection.cursor() as cursor:
                cursor.execute("SELECT count(*) FROM rag_embeddings")
                count = cursor.fetchone()[0]
        return {
            "status": "ok", "indexed_chunks": count, "read_only": False,
            "vector_available": True, "semantic_retrieval": True,
        }
