"""Internal ML service. Not exposed outside the compose network: the Node API authenticates
callers and resolves tenancy, then calls this service with an already-authorized collection_id."""

from contextlib import asynccontextmanager
from typing import Literal
from uuid import UUID

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from psycopg.errors import ForeignKeyViolation
from pydantic import BaseModel, Field

from app.config import Settings
from app.embedder import approx_token_count, build_embedder
from app.parsers import UnsupportedFileType
from app.pipeline import EmptyDocument, IngestPipeline
from app.store import Store


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Connect to Postgres and probe the embedding provider before serving: /health only answers
    # once both work, so the compose healthcheck doubles as a dependency check.
    settings = Settings.from_env()
    store = Store(settings.database_url)
    embedder = build_embedder(settings)
    app.state.settings = settings
    app.state.embedder = embedder
    app.state.pipeline = IngestPipeline(settings, approx_token_count, embedder, store)
    yield
    store.close()


app = FastAPI(title="rag-ml", lifespan=lifespan)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/info")
def info(request: Request) -> dict:
    """Which model produces this service's vectors. The API keys its embedding cache on this."""
    embedder = request.app.state.embedder
    return {"model_id": embedder.model_id, "dim": embedder.dim}


class IngestResponse(BaseModel):
    document_id: str
    created: bool
    chunk_count: int


# Plain `def` (not `async def`): FastAPI runs these in a threadpool, so CPU-bound
# embedding doesn't block the event loop and stall /health or other requests.
@app.post("/ingest", response_model=IngestResponse)
def ingest(request: Request, collection_id: UUID = Form(...), file: UploadFile = File(...)):
    limit = request.app.state.settings.max_upload_bytes
    data = file.file.read(limit + 1)
    if len(data) > limit:
        raise HTTPException(413, f"File exceeds {limit} bytes")
    try:
        result = request.app.state.pipeline.ingest(
            str(collection_id), file.filename or "upload", file.content_type, data
        )
    except UnsupportedFileType as e:
        raise HTTPException(415, str(e)) from e
    except EmptyDocument as e:
        raise HTTPException(422, str(e)) from e
    except ForeignKeyViolation as e:
        raise HTTPException(404, "Collection not found") from e
    return IngestResponse(**result.__dict__)


class EmbedRequest(BaseModel):
    texts: list[str] = Field(min_length=1, max_length=256)
    kind: Literal["query", "document"] = "query"


class EmbedResponse(BaseModel):
    model: str
    dim: int
    embeddings: list[list[float]]


@app.post("/embed", response_model=EmbedResponse)
def embed(request: Request, body: EmbedRequest):
    embedder = request.app.state.embedder
    return EmbedResponse(model=embedder.model_id, dim=embedder.dim, embeddings=embedder.embed(body.texts, body.kind))
