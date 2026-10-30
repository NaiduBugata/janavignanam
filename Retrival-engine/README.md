# Local RAG Retrieval Engine

The application supports two storage modes. `VECTOR_STORE=local` is the original
document-grounded Phase 1 mode with DOCX ingestion, sentence-transformer embeddings,
SQLite metadata, and a persisted NumPy vector index. `VECTOR_STORE=neon` connects to
the existing Neon database in strict read-only mode.

## Run locally

### Backend

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
Copy-Item .env.example .env
python -m uvicorn app.main:app --reload
```

Set `GROQ_API_KEY` and a currently supported `GROQ_MODEL` in `backend/.env`.
The default MiniLM cosine threshold is `0.20`; keep it configurable and use the
retrieval logs to tune it for a different embedding model or corpus.
The app starts without Groq credentials, but queries with retrieved context return
HTTP 503 until Groq is configured. Questions with no relevant context are handled locally.

### Frontend

```powershell
cd frontend
npm install
npm run dev
```

Open `http://localhost:5174`, upload a Word document, and ask questions.
The frontend uses `http://localhost:8000/api` by default; override it with
`VITE_API_BASE_URL` when deploying the backend elsewhere.

## API

- `POST /api/documents/upload` - multipart `.docx` ingestion
- `GET /api/documents` - indexed documents
- `DELETE /api/documents/{document_id}` - remove document and vectors
- `POST /api/rag/query` - grounded query (`{"question":"...", "document_id":"optional UUID"}`)
- `GET /api/health` - local store and configuration status

## Architecture

The RAG orchestration depends on `VectorStore` in `backend/app/storage/interfaces.py`.
`LocalVectorStore` remains available for local mode. `NeonReadOnlyStore` reads the
existing `mediasphere.documents` JSONB table using transaction-scoped `SELECT` queries.
It rejects upload and delete operations. The inspected Neon database has no pgvector
extension or embedding column, so Neon mode uses a clearly reported keyword retrieval
fallback; semantic vector retrieval becomes available only if an existing vector column
and pgvector support are added by the database owner. The application never creates or
modifies Neon objects.

## Neon to PGVector deployment

Set `VECTOR_STORE=pgvector`, `NEON_DATABASE_URL` to the existing read-only source,
and `PGVECTOR_DATABASE_URL` to a separate PostgreSQL database with pgvector. The
application does not synchronize on startup. Run the explicit sync command:

```powershell
cd backend
python -m app.sync
```

Repeated runs are idempotent by `chunk_id`. The sync creates schema objects only in
the separate PGVector target, never in Neon. Use `--limit N` for an incremental test.

For local Docker deployment:

```powershell
$env:NEON_DATABASE_URL = "your-read-only-neon-url"
$env:GROQ_API_KEY = "your-groq-key"
$env:GROQ_MODEL = "your-supported-groq-model"
docker compose up --build -d
docker compose exec backend python -m app.sync
```

For production, provide the same variables through the platform secret manager and
use a managed PostgreSQL provider with pgvector for `PGVECTOR_DATABASE_URL`. Do not
put credentials in images, source control, or frontend variables.

## Tests

```powershell
cd backend
python -m pytest
```

Tests cover chunk overlap, local persistence/search/deletion, and missing-context behavior.
External Groq calls are not claimed as tested unless credentials are supplied manually.

Using `python -m` for both commands is intentional: it guarantees that Uvicorn and
pytest use the same Python installation where the dependencies were installed.
