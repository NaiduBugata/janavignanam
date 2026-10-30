import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import router
from app.config.settings import get_settings
from app.embeddings.service import get_embedding_service
from app.groq.service import GroqService
from app.ingestion.service import IngestionService
from app.rag.service import RagService
from app.retrieval.service import RetrievalService
from app.storage.local_store import LocalVectorStore
from app.storage.neon_store import NeonReadOnlyStore
from app.storage.pgvector_store import PgVectorStore

settings = get_settings()
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
embedding_service = get_embedding_service(settings.embedding_model)
if settings.vector_store.lower() == "neon":
    store = NeonReadOnlyStore(settings.neon_database_url)
elif settings.vector_store.lower() == "pgvector":
    store = PgVectorStore(
        settings.pgvector_database_url,
        embedding_service.dimension,
        settings.pgvector_pool_min_size,
        settings.pgvector_pool_max_size,
    )
    store.ensure_schema()
else:
    store = LocalVectorStore(settings.data_dir)
ingestion_service = IngestionService(store, embedding_service, settings.chunk_size, settings.chunk_overlap)
retrieval_service = RetrievalService(store, embedding_service, settings.top_k, settings.similarity_threshold)
rag_service = RagService(retrieval_service, GroqService(settings))

app = FastAPI(title=settings.app_name)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5174", "http://127.0.0.1:5174"],
    allow_credentials=False,
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Accept"],
)
app.include_router(router)
