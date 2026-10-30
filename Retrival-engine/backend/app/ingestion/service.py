from pathlib import Path
from uuid import UUID, uuid4

from app.embeddings.service import EmbeddingService
from app.ingestion.docx_processor import extract_docx_text, split_text
from app.storage.interfaces import ChunkRecord
from app.storage.local_store import LocalVectorStore


class IngestionService:
    def __init__(self, store: LocalVectorStore, embeddings: EmbeddingService,
                 chunk_size: int, chunk_overlap: int) -> None:
        self.store = store
        self.embeddings = embeddings
        self.chunk_size = chunk_size
        self.chunk_overlap = chunk_overlap

    def ingest_docx(self, path: Path, original_filename: str) -> tuple[UUID, int]:
        text = extract_docx_text(str(path))
        text_chunks = split_text(text, self.chunk_size, self.chunk_overlap)
        if not text_chunks:
            raise ValueError("The Word document does not contain readable text")
        document_id = uuid4()
        embeddings = self.embeddings.embed_many([chunk.content for chunk in text_chunks])
        records = [
            ChunkRecord(
                document_id=document_id,
                document_name=original_filename,
                chunk_id=f"{document_id}:{chunk.index}",
                chunk_index=chunk.index,
                content=chunk.content,
                embedding=embedding,
                metadata={"source": original_filename},
            )
            for chunk, embedding in zip(text_chunks, embeddings, strict=True)
        ]
        count = self.store.add_document(document_id, original_filename, original_filename, records)
        return document_id, count
