from app.config import Settings
from app.pipeline import IngestPipeline, context_header
from app.parsers import Section


class FakeEmbedder:
    model_id, dim = "fake:model", 3

    def __init__(self):
        self.inputs: list[str] = []

    def embed(self, texts, kind):
        assert kind == "document"
        self.inputs.extend(texts)
        return [[1.0, 0.0, 0.0] for _ in texts]


class FakeStore:
    def __init__(self, existing=None):
        self.existing = existing
        self.inserted = None

    def find_document(self, client_id, collection_id, sha256):
        return self.existing

    def insert_document(self, client_id, collection_id, filename, mime_type, sha256, embedding_model, chunks):
        self.inserted = dict(client_id=client_id, filename=filename, mime_type=mime_type, model=embedding_model, chunks=chunks)
        return "doc-1", True


def make_pipeline(store, embedder=None):
    settings = Settings.from_env({})  # provider defaults, independent of the host env
    words = lambda t: len(t.split())
    return IngestPipeline(settings, words, embedder or FakeEmbedder(), store)


def test_context_header_uses_filename_stem_and_heading_path():
    assert context_header("docs/runbook.md", Section("x", {"heading_path": ["Deploys", "Rollback"]})) == (
        "runbook > Deploys > Rollback"
    )
    assert context_header("report.pdf", Section("x", {"page": 2})) == "report"


def test_ingest_embeds_header_plus_chunk_but_stores_raw_chunk():
    store, embedder = FakeStore(), FakeEmbedder()
    md = b"# Deploys\n## Rollback\nRun rollback.sh twice."
    result = make_pipeline(store, embedder).ingest("t1", "c1", "runbook.md", None, md)

    assert result.created and result.chunk_count == 1
    [row] = store.inserted["chunks"]
    assert row.content == "Run rollback.sh twice."
    assert row.metadata["heading_path"] == ["Deploys", "Rollback"]
    assert row.metadata["context"] == "runbook > Deploys > Rollback"  # feeds the weighted keyword index
    assert embedder.inputs == ["runbook > Deploys > Rollback\n\nRun rollback.sh twice."]
    assert store.inserted["mime_type"] == "text/markdown" and store.inserted["model"] == "fake:model"
    assert store.inserted["client_id"] == "t1"  # writes are scoped to the tenant (RLS)


def test_duplicate_upload_skips_parsing_and_embedding():
    embedder = FakeEmbedder()
    store = FakeStore(existing={"id": "doc-0", "chunk_count": 7})
    result = make_pipeline(store, embedder).ingest("t1", "c1", "a.txt", None, b"hello")
    assert (result.document_id, result.created, result.chunk_count) == ("doc-0", False, 7)
    assert embedder.inputs == [] and store.inserted is None
