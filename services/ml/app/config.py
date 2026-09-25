import os
from dataclasses import dataclass

# Defaults that only make sense together, per provider. Any of them can still be overridden by env.
_PROVIDER_DEFAULTS: dict[str, dict[str, str]] = {
    # nomic-embed-text: 768-d, 8k-token window, trained with task prefixes on BOTH sides.
    "ollama": {
        "EMBEDDING_MODEL": "nomic-embed-text",
        "EMBED_QUERY_PREFIX": "search_query: ",
        "EMBED_DOCUMENT_PREFIX": "search_document: ",
        "CHUNK_TOKENIZER": "approx",
        "CHUNK_TARGET_TOKENS": "600",
        "CHUNK_MAX_TOKENS": "800",
        "CHUNK_OVERLAP_TOKENS": "80",
    },
    # bge-base-en-v1.5: 768-d, 512-token window, instruction prefix on queries only.
    "local": {
        "EMBEDDING_MODEL": "BAAI/bge-base-en-v1.5",
        "EMBED_QUERY_PREFIX": "Represent this sentence for searching relevant passages: ",
        "EMBED_DOCUMENT_PREFIX": "",
        "CHUNK_TOKENIZER": "hf:BAAI/bge-base-en-v1.5",
        "CHUNK_TARGET_TOKENS": "450",
        "CHUNK_MAX_TOKENS": "500",  # leaves headroom under 512 for [CLS]/[SEP]
        "CHUNK_OVERLAP_TOKENS": "64",
    },
    "openai": {
        "EMBEDDING_MODEL": "text-embedding-3-small",
        "EMBED_QUERY_PREFIX": "",
        "EMBED_DOCUMENT_PREFIX": "",
        "CHUNK_TOKENIZER": "approx",
        "CHUNK_TARGET_TOKENS": "600",
        "CHUNK_MAX_TOKENS": "800",
        "CHUNK_OVERLAP_TOKENS": "80",
    },
}


@dataclass(frozen=True)
class Settings:
    database_url: str
    embeddings_provider: str  # ollama | local | openai
    embedding_model: str
    embedding_dim: int  # must match vector(N) in db/migrations/001_init.sql
    query_prefix: str
    document_prefix: str
    ollama_url: str
    ollama_num_ctx: int
    openai_base_url: str
    openai_api_key: str
    chunk_tokenizer: str  # 'approx' or 'hf:<model>'
    chunk_target_tokens: int
    chunk_max_tokens: int
    chunk_overlap_tokens: int
    max_upload_bytes: int

    @classmethod
    def from_env(cls, env: dict[str, str] | None = None) -> "Settings":
        env = dict(os.environ if env is None else env)
        provider = env.get("EMBEDDINGS_PROVIDER", "ollama")
        if provider not in _PROVIDER_DEFAULTS:
            raise ValueError(f"Unknown EMBEDDINGS_PROVIDER {provider!r}")
        get = lambda key, default=None: env.get(key, _PROVIDER_DEFAULTS[provider].get(key, default))
        return cls(
            database_url=get("DATABASE_URL", "postgresql://rag:rag@localhost:5432/rag"),
            embeddings_provider=provider,
            embedding_model=get("EMBEDDING_MODEL"),
            embedding_dim=int(get("EMBEDDING_DIM", "768")),
            query_prefix=get("EMBED_QUERY_PREFIX"),
            document_prefix=get("EMBED_DOCUMENT_PREFIX"),
            ollama_url=get("OLLAMA_URL", "http://localhost:11434"),
            # Chunks max out around 800 (estimated) tokens + a short header; 2048 leaves ~2.5x
            # margin for the approximate counter while keeping Ollama's memory use small.
            ollama_num_ctx=int(get("OLLAMA_NUM_CTX", "2048")),
            openai_base_url=get("OPENAI_BASE_URL", "https://api.openai.com/v1"),
            openai_api_key=get("OPENAI_API_KEY", ""),
            chunk_tokenizer=get("CHUNK_TOKENIZER"),
            chunk_target_tokens=int(get("CHUNK_TARGET_TOKENS")),
            chunk_max_tokens=int(get("CHUNK_MAX_TOKENS")),
            chunk_overlap_tokens=int(get("CHUNK_OVERLAP_TOKENS")),
            max_upload_bytes=int(get("MAX_UPLOAD_BYTES", str(20 * 1024 * 1024))),
        )
