from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


ROOT_DIR = Path(__file__).resolve().parents[3]


class Settings(BaseSettings):
    app_name: str = "Local RAG Retrieval Engine"
    groq_api_key: str = ""
    groq_model: str = ""
    embedding_model: str = "sentence-transformers/all-MiniLM-L6-v2"
    vector_store: str = "local"
    chunk_size: int = 800
    chunk_overlap: int = 120
    top_k: int = 5
    similarity_threshold: float = 0.20
    max_upload_size_mb: int = 20
    groq_timeout_seconds: float = 30.0
    database_url: str = ""
    neon_database_url: str = ""
    pgvector_database_url: str = ""
    sync_batch_size: int = 100
    pgvector_pool_min_size: int = 1
    pgvector_pool_max_size: int = 8
    data_dir: Path = ROOT_DIR / "data"

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    @property
    def documents_dir(self) -> Path:
        return self.data_dir / "documents"

    @property
    def vectors_dir(self) -> Path:
        return self.data_dir / "vectors"

    @property
    def metadata_dir(self) -> Path:
        return self.data_dir / "metadata"


@lru_cache
def get_settings() -> Settings:
    settings = Settings()
    for path in (settings.data_dir, settings.documents_dir, settings.vectors_dir, settings.metadata_dir):
        path.mkdir(parents=True, exist_ok=True)
    return settings
