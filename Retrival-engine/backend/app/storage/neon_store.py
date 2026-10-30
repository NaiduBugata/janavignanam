import re
from collections.abc import Sequence
from datetime import datetime
from typing import Any
from uuid import UUID

import numpy as np
import psycopg

from app.storage.interfaces import ChunkRecord, VectorStore


class NeonReadOnlyStore(VectorStore):
    schema = "mediasphere"
    table = "documents"

    def __init__(self, database_url: str) -> None:
        if not database_url:
            raise RuntimeError("NEON_DATABASE_URL is required when VECTOR_STORE=neon")
        self.database_url = database_url

    def _connect(self) -> psycopg.Connection:
        connection = psycopg.connect(self.database_url, connect_timeout=15, autocommit=False)
        with connection.cursor() as cursor:
            cursor.execute("SET TRANSACTION READ ONLY")
        return connection

    @staticmethod
    def _payload_text(payload: dict[str, Any]) -> str:
        return "\n".join(
            f"{key}: {value}" for key, value in payload.items()
            if key not in {"_id", "embedding", "vector"} and value not in (None, "")
        )

    def _records(self, rows: list[tuple[Any, ...]]) -> list[ChunkRecord]:
        records = []
        for collection, doc_id, payload, score in rows:
            payload = payload if isinstance(payload, dict) else {}
            content = self._payload_text(payload).strip()
            if not content:
                continue
            records.append(ChunkRecord(
                document_id=str(doc_id),
                document_name=str(payload.get("title") or payload.get("name") or collection),
                chunk_id=f"{collection}:{doc_id}",
                chunk_index=0,
                content=content,
                embedding=np.zeros(1, dtype=np.float32),
                metadata={"collection": collection, "source": payload.get("source", collection)},
                score=float(score),
            ))
        return records

    def fetch_records(self, batch_size: int = 100, offset: int = 0) -> list[ChunkRecord]:
        """Fetch source records using SELECT-only, read-only transactions."""
        with self._connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    "SELECT collection, doc_id, doc, 0::float "
                    "FROM mediasphere.documents "
                    "ORDER BY exported_at, doc_id LIMIT %s OFFSET %s",
                    (batch_size, offset),
                )
                rows = cursor.fetchall()
            connection.rollback()
        return self._records(rows)

    def add_document(self, document_id: UUID | str, document_name: str, original_filename: str,
                     chunks: Sequence[ChunkRecord]) -> int:
        raise RuntimeError("Neon read-only mode rejects document writes")

    def search(self, question: str, top_k: int, document_id: str | None = None) -> list[ChunkRecord]:
        tokens = re.findall(r"[\w]{3,}", question, re.UNICODE)
        if not tokens:
            return []
        score_sql = " + ".join("CASE WHEN doc::text ILIKE %s THEN 1 ELSE 0 END" for _ in tokens)
        where_sql = " OR ".join("doc::text ILIKE %s" for _ in tokens)
        parameters: list[Any] = [f"%{token}%" for token in tokens]
        if document_id:
            where_sql = f"({where_sql}) AND doc_id = %s"
            parameters.extend([f"%{token}%" for token in tokens])
            parameters.append(document_id)
        else:
            parameters.extend([f"%{token}%" for token in tokens])
        query = f"""SELECT collection, doc_id, doc, ({score_sql})::float AS score
                    FROM {self.schema}.{self.table}
                    WHERE {where_sql}
                    ORDER BY score DESC
                    LIMIT %s"""
        parameters.append(max(top_k * 4, top_k))
        with self._connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute(query, parameters)
                rows = cursor.fetchall()
            connection.rollback()
        return self._records(rows)[:top_k]

    def search_similar(self, embedding: np.ndarray, top_k: int, threshold: float,
                       document_id: UUID | str | None = None) -> list[ChunkRecord]:
        raise RuntimeError("Neon has no vector column; semantic pgvector retrieval is unavailable")

    def delete_document(self, document_id: UUID) -> bool:
        raise RuntimeError("Neon read-only mode rejects document deletion")

    def get_documents(self) -> list[dict[str, Any]]:
        with self._connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    "SELECT collection, doc_id, doc, exported_at "
                    "FROM mediasphere.documents ORDER BY exported_at DESC LIMIT 1000"
                )
                rows = cursor.fetchall()
            connection.rollback()
        documents = []
        for collection, doc_id, payload, created_at in rows:
            payload = payload if isinstance(payload, dict) else {}
            name = str(payload.get("title") or payload.get("name") or collection)
            documents.append({
                "document_id": str(doc_id),
                "document_name": name,
                "original_filename": name,
                "chunk_count": 1,
                "created_at": created_at or datetime.now(),
            })
        return documents

    def health_check(self) -> dict[str, Any]:
        with self._connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute("SELECT current_setting('transaction_read_only')")
                read_only = cursor.fetchone()[0] == "on"
                cursor.execute(
                    "SELECT count(*) FROM information_schema.columns "
                    "WHERE table_schema = 'mediasphere' AND table_name = 'documents'"
                )
                schema_available = cursor.fetchone()[0] > 0
                cursor.execute("SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector')")
                vector_available = cursor.fetchone()[0]
            connection.rollback()
        return {
            "status": "ok" if read_only and schema_available else "degraded",
            "indexed_chunks": 0,
            "read_only": read_only,
            "schema_available": schema_available,
            "vector_available": vector_available,
            "semantic_retrieval": vector_available,
        }
