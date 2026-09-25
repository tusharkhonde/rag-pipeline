# ADR 0004: Hybrid retrieval with Reciprocal Rank Fusion

**Status:** accepted

## Context
Dense (vector) retrieval handles paraphrase ("message broker" vs "Nimbus Queue") but is weak
on exact identifiers (`NimbusUnderReplicated`, `launchpad rollback`). Keyword search is the
opposite. A cross-encoder reranker was planned but its weights come from Hugging Face.

## Decision
Run both retrievers concurrently (20 candidates each) and merge with **Reciprocal Rank Fusion**:
`score = Σ 1 / (60 + rank)`. Keyword search uses Postgres full-text search with OR semantics
over stemmed terms, headings weighted A and body B. `RETRIEVAL_MODE` can select vector or
keyword only (used by the evaluation to compare modes).

## Consequences
- RRF needs no score normalization: cosine similarity and `ts_rank` are on incompatible scales,
  ranks are not. Agreement between both lists is rewarded naturally.
- The evaluation (eval/) showed hit@5 = 1.0 for all modes on the sample corpus, with MRR
  0.94 (hybrid), 0.87 (vector), 0.95 (keyword): questions written from the docs share their
  vocabulary, which favours keyword search; hybrid protects against either retriever's blind spots.
- Bug worth remembering: rewriting `plainto_tsquery` output through `to_tsquery('english', …)`
  stems terms twice (`releas` → `relea`) and silently misses matches; cast with `::tsquery`.

## Alternatives considered
- **Cross-encoder reranking:** the most precise second stage, unavailable without Hugging Face.
  An LLM-as-reranker would work but costs a CPU-bound LLM call per query.
- **Weighted score fusion:** requires per-corpus normalization and tuning.
- **Vector only:** simplest; misses exact-identifier queries.
