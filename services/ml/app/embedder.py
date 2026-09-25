"""Embedding providers behind one interface, selected by EMBEDDINGS_PROVIDER.

Swapping providers changes the vector space: vectors from different models aren't comparable,
even at the same dimension. So each chunk records the model_id that produced its vector, and
switching providers means re-embedding the corpus.
"""

import math
from typing import Literal, Protocol

import httpx

from app.chunker import TokenCounter
from app.config import Settings

Kind = Literal["query", "document"]


class Embedder(Protocol):
    model_id: str
    dim: int

    def embed(self, texts: list[str], kind: Kind) -> list[list[float]]: ...


# ---------------------------------------------------------------- token counting


class HfTokenCounter:
    """Exact counts with the embedding model's own Hugging Face tokenizer (needs the `local` extra)."""

    def __init__(self, model_name: str):
        from transformers import AutoTokenizer

        self._tokenizer = AutoTokenizer.from_pretrained(model_name)

    def __call__(self, text: str) -> int:
        # Special tokens ([CLS]/[SEP]) excluded; chunk_max_tokens leaves headroom for them.
        return len(self._tokenizer(text, add_special_tokens=False, verbose=False)["input_ids"])


def approx_token_count(text: str) -> int:
    """Deliberately pessimistic estimate for when the exact tokenizer isn't available.

    English prose averages ~4 chars/token and ~1.3 tokens/word for BERT-style tokenizers;
    identifiers, numbers and code run denser. Taking the max of two over-estimates means we
    under-fill chunks slightly rather than overflow the model's window. The model-side guard
    (Ollama's truncate=false) is what actually guarantees nothing is silently cut.
    """
    return max(math.ceil(len(text) / 3), math.ceil(len(text.split()) * 1.4))


def build_token_counter(spec: str) -> TokenCounter:
    """spec: 'approx' or 'hf:<model name>'."""
    if spec == "approx":
        return approx_token_count
    if spec.startswith("hf:"):
        return HfTokenCounter(spec.removeprefix("hf:"))
    raise ValueError(f"Unknown CHUNK_TOKENIZER {spec!r} (expected 'approx' or 'hf:<model>')")


# ---------------------------------------------------------------- providers


def _normalize(vector: list[float]) -> list[float]:
    norm = math.sqrt(sum(x * x for x in vector)) or 1.0
    return [x / norm for x in vector]


class OllamaEmbedder:
    """Embeddings from the Ollama container (the default here: no Hugging Face access needed)."""

    def __init__(
        self,
        base_url: str,
        model: str,
        query_prefix: str,
        document_prefix: str,
        num_ctx: int,
        transport: httpx.BaseTransport | None = None,
        batch_size: int = 32,
    ):
        self._client = httpx.Client(base_url=base_url, timeout=300, transport=transport)
        self._model = model
        self._prefix = {"query": query_prefix, "document": document_prefix}
        self._num_ctx = num_ctx
        self._batch_size = batch_size
        self.model_id = f"ollama:{model}"
        self.dim = len(self.embed(["dimension probe"], "query")[0])

    def embed(self, texts: list[str], kind: Kind) -> list[list[float]]:
        vectors: list[list[float]] = []
        for i in range(0, len(texts), self._batch_size):
            batch = [self._prefix[kind] + t for t in texts[i : i + self._batch_size]]
            response = self._client.post(
                "/api/embed",
                json={
                    "model": self._model,
                    "input": batch,
                    # Fail loudly if an input exceeds the context window instead of silently
                    # embedding only its first N tokens (and losing the rest from search).
                    "truncate": False,
                    "options": {"num_ctx": self._num_ctx},
                },
            )
            if response.status_code != 200:
                raise RuntimeError(f"Ollama /api/embed failed ({response.status_code}): {response.text[:300]}")
            vectors.extend(_normalize(v) for v in response.json()["embeddings"])
        return vectors


class LocalEmbedder:
    """In-process sentence-transformers (needs the `local` extra and Hugging Face weights)."""

    def __init__(self, model_name: str, query_prefix: str, document_prefix: str, batch_size: int = 32):
        from sentence_transformers import SentenceTransformer

        self._model = SentenceTransformer(model_name, device="cpu")
        self._prefix = {"query": query_prefix, "document": document_prefix}
        self._batch_size = batch_size
        self.model_id = f"local:{model_name}"
        self.dim = self._model.get_sentence_embedding_dimension()

    def embed(self, texts: list[str], kind: Kind) -> list[list[float]]:
        texts = [self._prefix[kind] + t for t in texts]
        # normalize_embeddings=True gives unit-length vectors: cosine similarity == dot product,
        # and scores are comparable across queries.
        vectors = self._model.encode(
            texts, batch_size=self._batch_size, normalize_embeddings=True, convert_to_numpy=True
        )
        return vectors.tolist()


class OpenAIEmbedder:
    """Any OpenAI-compatible /embeddings endpoint. Returns unit-normalized vectors."""

    _MAX_BATCH = 256

    def __init__(self, base_url: str, api_key: str, model: str, dim: int):
        self._client = httpx.Client(
            base_url=base_url, headers={"Authorization": f"Bearer {api_key}"}, timeout=60
        )
        self._model = model
        self.model_id = f"openai:{model}@{dim}"
        self.dim = dim

    def embed(self, texts: list[str], kind: Kind) -> list[list[float]]:
        vectors: list[list[float]] = []
        for i in range(0, len(texts), self._MAX_BATCH):
            batch = texts[i : i + self._MAX_BATCH]
            # text-embedding-3-* can shorten vectors natively ('dimensions') to fit our column.
            response = self._client.post(
                "/embeddings", json={"model": self._model, "input": batch, "dimensions": self.dim}
            )
            response.raise_for_status()
            data = sorted(response.json()["data"], key=lambda d: d["index"])
            vectors.extend(d["embedding"] for d in data)
        return vectors


def build_embedder(settings: Settings) -> Embedder:
    s = settings
    if s.embeddings_provider == "ollama":
        embedder: Embedder = OllamaEmbedder(
            s.ollama_url, s.embedding_model, s.query_prefix, s.document_prefix, s.ollama_num_ctx
        )
    elif s.embeddings_provider == "openai":
        embedder = OpenAIEmbedder(s.openai_base_url, s.openai_api_key, s.embedding_model, s.embedding_dim)
    elif s.embeddings_provider == "local":
        embedder = LocalEmbedder(s.embedding_model, s.query_prefix, s.document_prefix)
    else:
        raise ValueError(f"Unknown EMBEDDINGS_PROVIDER {s.embeddings_provider!r}")
    if embedder.dim != s.embedding_dim:
        raise RuntimeError(f"{embedder.model_id} produces {embedder.dim}-d vectors but the schema expects {s.embedding_dim}")
    return embedder
