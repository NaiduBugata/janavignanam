import tempfile
from pathlib import Path
from uuid import UUID

from fastapi import APIRouter, File, HTTPException, UploadFile, status

from app.config.settings import get_settings
from app.schemas.models import DocumentResponse, HealthResponse, QueryRequest, QueryResponse

router = APIRouter(prefix="/api")
settings = get_settings()


def get_services() -> tuple[object, object, object]:
    from app.main import ingestion_service, rag_service, store

    return ingestion_service, rag_service, store


@router.post("/documents/upload", response_model=DocumentResponse, status_code=status.HTTP_201_CREATED)
async def upload_document(file: UploadFile = File(...)) -> DocumentResponse:
    if settings.vector_store.lower() == "neon":
        raise HTTPException(405, "Document ingestion is disabled in Neon read-only mode")
    if not file.filename or not file.filename.lower().endswith(".docx"):
        raise HTTPException(400, "Only .docx files are supported")
    data = await file.read()
    if len(data) > settings.max_upload_size_mb * 1024 * 1024:
        raise HTTPException(413, "Document exceeds the configured size limit")
    ingestion, _, store = get_services()
    temporary_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(suffix=".docx", delete=False) as temporary:
            temporary.write(data)
            temporary_path = Path(temporary.name)
        document_id, chunk_count = ingestion.ingest_docx(temporary_path, file.filename)
        document = next(item for item in store.get_documents() if item["document_id"] == str(document_id))
        return DocumentResponse(**document)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    finally:
        if temporary_path:
            temporary_path.unlink(missing_ok=True)


@router.get("/documents", response_model=list[DocumentResponse])
def list_documents() -> list[DocumentResponse]:
    _, _, store = get_services()
    return [DocumentResponse(**document) for document in store.get_documents()]


@router.delete("/documents/{document_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_document(document_id: UUID) -> None:
    if settings.vector_store.lower() in {"neon", "pgvector"}:
        raise HTTPException(405, "Document deletion is disabled in Neon read-only mode")
    _, _, store = get_services()
    if not store.delete_document(document_id):
        raise HTTPException(404, "Document not found")


@router.post("/rag/query", response_model=QueryResponse)
async def query(request: QueryRequest) -> QueryResponse:
    _, rag, _ = get_services()
    try:
        return await rag.answer(request.question, request.top_k, request.document_id)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(503, str(exc)) from exc


@router.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    _, _, store = get_services()
    health_data = store.health_check()
    return HealthResponse(
        status=health_data["status"],
        embedding_model=settings.embedding_model,
        vector_store=settings.vector_store,
        groq_configured=bool(settings.groq_api_key and settings.groq_model),
        indexed_chunks=health_data["indexed_chunks"],
        read_only=health_data.get("read_only", False),
        vector_available=health_data.get("vector_available", False),
        semantic_retrieval=health_data.get("semantic_retrieval", False),
    )
