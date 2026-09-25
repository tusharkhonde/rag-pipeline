import json
import math

import httpx
import pytest

from app.config import Settings
from app.embedder import OllamaEmbedder, approx_token_count, build_token_counter


class FakeOllama:
    """Records /api/embed requests and returns deterministic, un-normalized vectors."""

    def __init__(self, status: int = 200):
        self.requests: list[dict] = []
        self.status = status

    def __call__(self, request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        self.requests.append(body)
        if self.status != 200:
            return httpx.Response(self.status, text="input length exceeds context length")
        return httpx.Response(200, json={"embeddings": [[3.0, 4.0] for _ in body["input"]]})


def make(fake: FakeOllama, batch_size: int = 32) -> OllamaEmbedder:
    return OllamaEmbedder(
        "http://ollama", "nomic-embed-text", "search_query: ", "search_document: ", 2048,
        transport=httpx.MockTransport(fake), batch_size=batch_size,
    )


def test_probes_dimension_and_sets_model_id():
    embedder = make(FakeOllama())
    assert embedder.dim == 2 and embedder.model_id == "ollama:nomic-embed-text"


def test_applies_task_prefix_per_kind_and_disables_truncation():
    fake = FakeOllama()
    embedder = make(fake)
    embedder.embed(["how do I roll back?"], "query")
    embedder.embed(["Rollbacks use rollback.sh."], "document")
    query_req, doc_req = fake.requests[-2:]
    assert query_req["input"] == ["search_query: how do I roll back?"]
    assert doc_req["input"] == ["search_document: Rollbacks use rollback.sh."]
    assert doc_req["truncate"] is False and doc_req["options"] == {"num_ctx": 2048}


def test_returns_unit_length_vectors():
    [vector] = make(FakeOllama()).embed(["x"], "document")
    assert vector == pytest.approx([0.6, 0.8]) and math.hypot(*vector) == pytest.approx(1.0)


def test_batches_large_inputs():
    fake = FakeOllama()
    vectors = make(fake, batch_size=2).embed(["a", "b", "c", "d", "e"], "document")
    assert len(vectors) == 5
    assert [len(r["input"]) for r in fake.requests[1:]] == [2, 2, 1]  # [0] is the dimension probe


def test_surfaces_ollama_errors_instead_of_returning_partial_results():
    fake = FakeOllama()
    embedder = make(fake)
    fake.status = 400
    with pytest.raises(RuntimeError, match="exceeds context length"):
        embedder.embed(["too long"], "document")


@pytest.mark.parametrize(
    "text",
    [
        "Rollbacks are performed by running the rollback script twice.",
        "nimbus-queue-7 q_depth_p99=259ms RUNBOOK-0007 0x7f3a9c2e",
        "def handler(event, ctx): return {'statusCode': 200}",
    ],
)
def test_approx_count_overestimates_word_count(text):
    # Every BERT-style tokenizer produces >= 1 token per whitespace word; the estimate must too.
    assert approx_token_count(text) > len(text.split())


def test_token_counter_spec():
    assert build_token_counter("approx") is approx_token_count
    with pytest.raises(ValueError):
        build_token_counter("tiktoken")


def test_provider_defaults_travel_together():
    ollama = Settings.from_env({})
    assert (ollama.embedding_model, ollama.document_prefix, ollama.chunk_max_tokens) == (
        "nomic-embed-text", "search_document: ", 800,
    )
    local = Settings.from_env({"EMBEDDINGS_PROVIDER": "local"})
    assert local.chunk_tokenizer == "hf:BAAI/bge-base-en-v1.5" and local.chunk_max_tokens == 500
    assert Settings.from_env({"CHUNK_MAX_TOKENS": "700"}).chunk_max_tokens == 700
