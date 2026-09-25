"""Uses the real bge tokenizer (baked into the image) to prove chunks fit the model window."""

from pathlib import Path

import pytest

from app.chunker import chunk_text

transformers = pytest.importorskip("transformers")
MODEL_LIMIT = 512  # bge-base-en-v1.5 max sequence length, including [CLS] and [SEP]


@pytest.fixture(scope="module")
def tokenizer():
    return transformers.AutoTokenizer.from_pretrained("BAAI/bge-base-en-v1.5")


def test_every_chunk_fits_the_embedding_window(tokenizer):
    count = lambda t: len(tokenizer(t, add_special_tokens=False, verbose=False)["input_ids"])
    # Mixed prose, identifiers and numbers tokenize to many more tokens than words.
    text = " ".join(
        f"Service nimbus-queue-{i} emits metric q_depth_p99={i * 37}ms; see RUNBOOK-{i:04d}." for i in range(600)
    )
    chunks = chunk_text(text, count, target_tokens=450, max_tokens=500, overlap_tokens=64)
    assert len(chunks) > 5
    for c in chunks:
        with_specials = len(tokenizer(c.text)["input_ids"])
        assert with_specials <= MODEL_LIMIT, with_specials
