-- 001_init: core schema for tenants, collections, documents and embedded chunks.
-- Applied by the API's migration runner (services/api/src/db/migrate.ts) inside a transaction.

CREATE EXTENSION IF NOT EXISTS vector;

-- An API client (tenant). Authenticates with client_id + secret via the client-credentials grant.
CREATE TABLE clients (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   text NOT NULL UNIQUE,          -- public identifier, sent in token requests
  secret_hash text NOT NULL,                 -- argon2id hash; the raw secret is never stored
  name        text NOT NULL,
  scopes      text[] NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- A named set of documents owned by exactly one client. This is the unit of tenancy.
CREATE TABLE collections (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id  uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  name       text NOT NULL,
  -- Bumped on every successful ingest. Part of the answer-cache key, so new documents
  -- invalidate cached answers without having to find and delete keys in Redis.
  version    integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, name)
);

CREATE TABLE documents (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  collection_id uuid NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  filename      text NOT NULL,
  mime_type     text NOT NULL,
  -- Content hash: uploading the same bytes twice into a collection is a no-op (idempotent ingest).
  sha256        text NOT NULL,
  status        text NOT NULL DEFAULT 'processing'
                CHECK (status IN ('processing', 'ready', 'failed')),
  error         text,
  chunk_count   integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (collection_id, sha256)
);

CREATE TABLE chunks (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id     uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  -- Denormalized from documents so similarity search can filter by collection without a join.
  collection_id   uuid NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  ordinal         integer NOT NULL,          -- position within the document
  content         text NOT NULL,
  token_count     integer NOT NULL,
  -- page (PDFs), heading_path (Markdown), char_start/char_end: used to render citations.
  metadata        jsonb NOT NULL DEFAULT '{}',
  -- 768 dims = nomic-embed-text (via Ollama). Changing embedding models means a new column/table + re-embed.
  embedding       vector(768) NOT NULL,
  -- Which model produced the vector; the API refuses to query if it doesn't match the configured model.
  embedding_model text NOT NULL,
  -- Keyword index for optional hybrid (BM25-style + vector) search. Kept in sync automatically.
  tsv             tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED,
  UNIQUE (document_id, ordinal)
);

-- Approximate nearest-neighbour index. HNSW over IVFFlat: no training step on existing data,
-- better recall/latency tradeoff, and it handles incremental inserts well.
--   m = graph connectivity (edges per node), ef_construction = build-time search width.
-- vector_cosine_ops must match the operator used in queries (<=>), or the index is ignored.
CREATE INDEX chunks_embedding_hnsw ON chunks
  USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);

CREATE INDEX chunks_tsv_gin ON chunks USING gin (tsv);
CREATE INDEX chunks_collection_idx ON chunks (collection_id);
CREATE INDEX documents_collection_idx ON documents (collection_id);
