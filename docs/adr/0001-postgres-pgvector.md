# ADR 0001: PostgreSQL + pgvector as the vector store

**Status:** accepted

## Context
The system stores documents, chunks, embeddings, tenants and credentials, and must answer
"nearest chunks to this vector, within this tenant's collection" with low latency.

## Decision
Use PostgreSQL 17 with the pgvector extension (0.8), one `vector(768)` column on `chunks`,
and an **HNSW** index with `vector_cosine_ops`.

## Consequences
- One transactional store for everything: a document and all of its chunks commit atomically,
  deletes cascade, and tenancy is enforced by the same database (row-level security, ADR 0005).
- Metadata filtering is plain SQL (`WHERE collection_id = …`), and full-text search for hybrid
  retrieval uses the same rows (ADR 0004).
- Filtered ANN caveat: HNSW finds `ef_search` candidates *before* the WHERE clause is applied.
  pgvector 0.8's `hnsw.iterative_scan = relaxed_order` keeps scanning until enough rows pass
  the filter; results are re-sorted in an outer query.
- The embedding dimension is fixed in the schema. Changing models means a new column/table and
  re-embedding; `chunks.embedding_model` records the producer and the API refuses mixed queries.

## Alternatives considered
- **Dedicated vector DB (Qdrant, Weaviate, Pinecone):** better at very large scale (hundreds of
  millions of vectors, high QPS, built-in sharding), but a second system to operate and keep
  consistent with Postgres, with tenancy and metadata living in two places.
- **IVFFlat index:** smaller and faster to build, but its clusters are trained on the data
  present at build time (useless on an empty table) and recall degrades as data drifts.
  HNSW has no training step and handles incremental inserts.
- **Exact search (no index):** perfect recall and fine for thousands of rows, linear cost after that.
