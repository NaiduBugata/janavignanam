import argparse
import logging

from app.config.settings import get_settings
from app.embeddings.service import get_embedding_service
from app.ingestion.docx_processor import TextChunk, split_text
from app.storage.neon_store import NeonReadOnlyStore
from app.storage.pgvector_store import PgVectorStore
from app.storage.interfaces import ChunkRecord

logger = logging.getLogger(__name__)


def synchronize(limit: int | None = None) -> int:
    settings = get_settings()
    embeddings = get_embedding_service(settings.embedding_model)
    source = NeonReadOnlyStore(settings.neon_database_url)
    target = PgVectorStore(
        settings.pgvector_database_url,
        embeddings.dimension,
        settings.pgvector_pool_min_size,
        settings.pgvector_pool_max_size,
    )
    target.ensure_schema()
    offset = 0
    synced = 0
    try:
        while limit is None or synced < limit:
            batch_size = min(settings.sync_batch_size, limit - synced) if limit else settings.sync_batch_size
            records = source.fetch_records(batch_size=batch_size, offset=offset)
            if not records:
                break
            pending: list[tuple[str, ChunkRecord, list[TextChunk]]] = []
            texts: list[str] = []
            for record in records:
                text_chunks = split_text(record.content, settings.chunk_size, settings.chunk_overlap)
                if not text_chunks:
                    continue
                target_document_id = (
                    f"{record.metadata.get('collection', 'source')}:{record.document_id}"
                )
                pending.append((target_document_id, record, text_chunks))
                texts.extend(chunk.content for chunk in text_chunks)
            vectors = embeddings.embed_many(texts) if texts else []
            vector_index = 0
            for target_document_id, record, text_chunks in pending:
                chunks = [
                    ChunkRecord(
                        document_id=target_document_id,
                        document_name=record.document_name,
                        chunk_id=f"{target_document_id}:{chunk.index}",
                        chunk_index=chunk.index,
                        content=chunk.content,
                        embedding=vector,
                        metadata=record.metadata,
                    )
                    for chunk, vector in zip(
                        text_chunks,
                        vectors[vector_index:vector_index + len(text_chunks)],
                        strict=True,
                    )
                ]
                vector_index += len(text_chunks)
                target.replace_document_chunks(target_document_id, chunks)
                synced += 1
            offset += len(records)
            logger.info("Synchronized %s source records", synced)
    finally:
        target.close()
    return synced


def main() -> None:
    parser = argparse.ArgumentParser(description="Synchronize Neon documents into PGVector")
    parser.add_argument("--limit", type=int, default=None, help="Maximum source records to sync")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    print(f"Synchronized {synchronize(args.limit)} source records")


if __name__ == "__main__":
    main()
