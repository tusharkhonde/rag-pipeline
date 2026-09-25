# ADR 0006: Two Redis caches, invalidated by key design

**Status:** accepted

## Decision
- **Query-embedding cache:** key `emb:<model id>:sha256(text)`, value float32 bytes (base64,
  ~4 KB vs ~15 KB as JSON), TTL 7 days. The model id in the key means a model switch never
  serves vectors from the old space.
- **Answer cache:** key = sha256 of (tenant, collection id, **collection version**, normalized
  question, LLM model, embedding model, retrieval mode, top-k, prompt version), TTL 1 hour.
  Ingest bumps `collections.version`, so new documents invalidate old answers **without
  finding and deleting keys**. Partial answers from aborted streams are never cached.
- Redis runs with `allkeys-lru` and a memory cap; the client fails fast (no offline queue),
  and a fail-safe wrapper turns Redis errors into cache misses.

## Consequences
- Repeated questions return in ~5 ms instead of ~100 s on CPU inference.
- Cache failures degrade performance, never correctness or availability.
- Tenant in the key: one tenant can never receive another's cached answer.

## Alternatives considered
- **Semantic caching** (reuse answers for *similar* questions via embedding similarity):
  higher hit rate, but a wrong-answer risk when similar questions need different answers.
- **Explicit invalidation on ingest:** requires tracking which keys belong to a collection.
