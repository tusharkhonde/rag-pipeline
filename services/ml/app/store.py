import json
from dataclasses import dataclass

from psycopg_pool import ConnectionPool


@dataclass(frozen=True)
class ChunkRow:
    ordinal: int
    content: str
    token_count: int
    metadata: dict
    embedding: list[float]


def to_pgvector(vector: list[float]) -> str:
    # pgvector's text format '[0.1,0.2,...]'. 9 significant digits round-trips float32 exactly.
    return "[" + ",".join(f"{x:.9g}" for x in vector) + "]"


def _as_tenant(conn, client_id: str) -> None:
    """Scope this transaction to one tenant under Postgres Row-Level Security (migration 003).

    SET LOCAL lasts until the transaction ends, so nothing leaks to the next use of a pooled connection.
    """
    conn.execute("SET LOCAL ROLE rag_app")
    conn.execute("SELECT set_config('app.client_id', %s, true)", (client_id,))


class Store:
    def __init__(self, dsn: str):
        self._pool = ConnectionPool(dsn, min_size=1, max_size=4, open=True)

    def close(self) -> None:
        self._pool.close()

    def find_document(self, client_id: str, collection_id: str, sha256: str) -> dict | None:
        with self._pool.connection() as conn, conn.transaction():
            _as_tenant(conn, client_id)
            row = conn.execute(
                "SELECT id, chunk_count FROM documents WHERE collection_id = %s AND sha256 = %s",
                (collection_id, sha256),
            ).fetchone()
        return {"id": str(row[0]), "chunk_count": row[1]} if row else None

    def insert_document(
        self,
        client_id: str,
        collection_id: str,
        filename: str,
        mime_type: str,
        sha256: str,
        embedding_model: str,
        chunks: list[ChunkRow],
    ) -> tuple[str, bool]:
        """Insert a document and all its chunks atomically. Returns (document_id, created).

        ON CONFLICT DO NOTHING makes the unique (collection_id, sha256) constraint the
        arbiter when two identical uploads race: exactly one wins, the other gets the
        existing id. A check-then-insert in application code can't guarantee that.

        Runs as the tenant: if collection_id belongs to another client, RLS rejects the insert
        even though the API already checked ownership (defense in depth).
        """
        with self._pool.connection() as conn, conn.transaction():
            _as_tenant(conn, client_id)
            row = conn.execute(
                """INSERT INTO documents (collection_id, filename, mime_type, sha256, status, chunk_count)
                   VALUES (%s, %s, %s, %s, 'ready', %s)
                   ON CONFLICT (collection_id, sha256) DO NOTHING
                   RETURNING id""",
                (collection_id, filename, mime_type, sha256, len(chunks)),
            ).fetchone()
            if row is None:
                existing = conn.execute(
                    "SELECT id FROM documents WHERE collection_id = %s AND sha256 = %s",
                    (collection_id, sha256),
                ).fetchone()
                return str(existing[0]), False

            document_id = row[0]
            with conn.cursor() as cur:
                cur.executemany(
                    """INSERT INTO chunks (document_id, collection_id, ordinal, content, token_count,
                                           metadata, embedding, embedding_model)
                       VALUES (%s, %s, %s, %s, %s, %s, %s::vector, %s)""",
                    [
                        (document_id, collection_id, c.ordinal, c.content, c.token_count,
                         json.dumps(c.metadata), to_pgvector(c.embedding), embedding_model)
                        for c in chunks
                    ],
                )
            # New content: bump the version so cached answers for this collection stop matching.
            conn.execute("UPDATE collections SET version = version + 1 WHERE id = %s", (collection_id,))
            return str(document_id), True
