# ADR 0002: Structure-aware, token-sized chunking with overlap

**Status:** accepted

## Context
Retrieval quality depends heavily on chunking. Too large and one vector blurs several topics
and wastes prompt space; too small and chunks lose the context needed to answer. Embedding
models also silently truncate input beyond their context window.

## Decision
- Parse documents into **sections** that share one citation location: a PDF page, or a
  Markdown heading path. Chunks never cross sections.
- Within a section, split into atoms (sentences/lines; oversized atoms by words, then
  characters) and pack them greedily to a **target of 600 tokens, hard max 800, overlap 80**.
- Prepend a **context header** (`doc > heading > subheading`) to each chunk's *embedding input*,
  and store it in `metadata.context`, where the keyword index weights it above body text.
- Size chunks with a deliberately **pessimistic token estimate**, and call the embedding model
  with `truncate: false` so an oversized input fails loudly instead of losing its tail.

## Consequences
- Every chunk has exactly one citation location, and character offsets back into the source.
- Short sections produce small chunks (precise citations; merging small siblings is a
  possible improvement if evaluation shows it helps).
- The token estimate under-fills chunks slightly; that is the price of not loading the
  model's tokenizer in-process (the model runs inside Ollama).

## Alternatives considered
- **Fixed-size windows:** simplest, but split mid-sentence and mix sections.
- **Semantic chunking** (split where embedding similarity drops): slower at ingest, harder to
  test and explain, gains are corpus-dependent.
- **Whole-document or per-page embeddings:** too coarse for precise retrieval.
