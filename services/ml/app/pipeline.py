"""Ingestion orchestration: hash → dedupe → parse → chunk → embed → store."""

import hashlib
from dataclasses import dataclass
from pathlib import PurePath

from app.chunker import TokenCounter, chunk_text
from app.config import Settings
from app.embedder import Embedder
from app.parsers import Section, detect_kind, parse
from app.store import ChunkRow, Store

_MIME = {"pdf": "application/pdf", "markdown": "text/markdown", "text": "text/plain"}


class EmptyDocument(ValueError):
    pass


@dataclass(frozen=True)
class IngestResult:
    document_id: str
    created: bool  # False = identical file was already in this collection
    chunk_count: int


def context_header(filename: str, section: Section) -> str:
    """'handbook > Deploys > Rollback': prepended to each chunk's *embedding input* only.

    A chunk from the middle of a section often never names its topic ("Run the script
    twice..."). Prefixing where it came from lets the vector capture that context.
    """
    return " > ".join([PurePath(filename).stem, *section.metadata.get("heading_path", [])])


class IngestPipeline:
    def __init__(self, settings: Settings, count_tokens: TokenCounter, embedder: Embedder, store: Store):
        self._settings = settings
        self._count = count_tokens
        self._embedder = embedder
        self._store = store

    def ingest(
        self, client_id: str, collection_id: str, filename: str, content_type: str | None, data: bytes
    ) -> IngestResult:
        kind = detect_kind(filename, content_type)
        sha256 = hashlib.sha256(data).hexdigest()

        # Cheap early exit before the expensive embed step; insert_document still handles races.
        existing = self._store.find_document(client_id, collection_id, sha256)
        if existing:
            return IngestResult(existing["id"], False, existing["chunk_count"])

        rows, embed_inputs = [], []
        for section in parse(data, kind):
            header = context_header(filename, section)
            # Reserve room for the header so header + chunk still fits the model's window.
            header_tokens = self._count(header) + 2
            max_tokens = self._settings.chunk_max_tokens - header_tokens
            for chunk in chunk_text(
                section.text,
                self._count,
                target_tokens=min(self._settings.chunk_target_tokens, max_tokens),
                max_tokens=max_tokens,
                overlap_tokens=self._settings.chunk_overlap_tokens,
            ):
                metadata = {**section.metadata, "context": header, "char_start": chunk.char_start, "char_end": chunk.char_end}
                rows.append((chunk, metadata))
                embed_inputs.append(f"{header}\n\n{chunk.text}")

        if not rows:
            raise EmptyDocument(f"No extractable text in {filename!r} (scanned PDF without a text layer?)")

        # Embedding runs outside any DB transaction: it's the slow step, and holding a
        # transaction open during it would pin a connection and its locks for seconds.
        vectors = self._embedder.embed(embed_inputs, kind="document")

        chunk_rows = [
            ChunkRow(i, chunk.text, chunk.token_count, metadata, vector)
            for i, ((chunk, metadata), vector) in enumerate(zip(rows, vectors, strict=True))
        ]
        document_id, created = self._store.insert_document(
            client_id, collection_id, filename, _MIME[kind], sha256, self._embedder.model_id, chunk_rows
        )
        return IngestResult(document_id, created, len(chunk_rows))
