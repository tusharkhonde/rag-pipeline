# ADR 0003: Local inference with Ollama behind OpenAI-compatible APIs

**Status:** accepted

## Context
The project must run entirely on a laptop with one command, cost nothing per query, and still
be able to switch to hosted models. The development network also blocks Hugging Face, so model
weights must come from somewhere else.

## Decision
- Run **Ollama inside Docker Compose** for both models: `qwen2.5:7b` (generation) and
  `nomic-embed-text` (768-d embeddings). One-shot compose jobs pull the models on first run.
- Call generation through the **OpenAI-compatible chat API** (`LLM_BASE_URL`, `LLM_MODEL`,
  `LLM_API_KEY`), and embeddings through a provider interface (`EMBEDDINGS_PROVIDER=ollama|openai`).
- Set `OLLAMA_CONTEXT_LENGTH=8192`: Ollama silently drops the *start* of an over-long prompt,
  which is where the grounding rules live.

## Consequences
- Private by default: documents and questions never leave the machine.
- Docker on macOS has no GPU access, so a 7B model runs on CPU: roughly 2–3 tokens/s and
  30–100 s per answer. Streaming (SSE) keeps it usable; `qwen2.5:3b` is a faster option.
- Swapping to a hosted LLM is a config change. Swapping the embedding provider requires
  re-ingesting (vectors from different models are not comparable).

## Alternatives considered
- **Hosted APIs only:** fastest and highest quality, but costs money per query, needs keys,
  and sends documents to a third party.
- **Native (non-Docker) Ollama on macOS:** Metal GPU acceleration, 5–10× faster, but the stack
  would no longer be self-contained.
- **llama3.1:8b:** comparable quality; qwen2.5:7b follows the citation format more reliably and is smaller.
- **sentence-transformers in-process:** ruled out: weights come from Hugging Face.
