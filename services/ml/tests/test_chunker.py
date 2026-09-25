import pytest

from app.chunker import chunk_text


def words(text: str) -> int:
    """Fake tokenizer: one token per whitespace-separated word. Keeps tests fast and readable."""
    return len(text.split())


def sentences(n: int, length: int = 10) -> str:
    return " ".join(f"S{i} " + " ".join(["w"] * (length - 2)) + "." for i in range(n))


def test_empty_and_whitespace_produce_no_chunks():
    assert chunk_text("", words) == []
    assert chunk_text(" \n\n  ", words) == []


def test_short_text_is_one_chunk_with_exact_offsets():
    text = "\n  Hello world. Second sentence.  \n"
    [chunk] = chunk_text(text, words, target_tokens=50, max_tokens=60, overlap_tokens=5)
    assert chunk.text == "Hello world. Second sentence."
    assert text[chunk.char_start : chunk.char_end] == chunk.text


def test_chunks_respect_target_and_max():
    chunks = chunk_text(sentences(100), words, target_tokens=50, max_tokens=60, overlap_tokens=10)
    assert len(chunks) > 1
    assert all(c.token_count <= 50 for c in chunks)  # sentences are 10 tokens, so packing hits target exactly


def test_every_sentence_is_covered():
    text = sentences(40)
    chunks = chunk_text(text, words, target_tokens=50, max_tokens=60, overlap_tokens=10)
    for i in range(40):
        assert any(f"S{i} " in c.text for c in chunks), f"sentence {i} lost"


def test_consecutive_chunks_overlap_by_trailing_sentences():
    chunks = chunk_text(sentences(20), words, target_tokens=50, max_tokens=60, overlap_tokens=10)
    for prev, nxt in zip(chunks, chunks[1:]):
        last_sentence = prev.text.rsplit("S", 1)[1].split()[0]  # e.g. "4" from "S4 w w ..."
        assert nxt.text.startswith(f"S{last_sentence} ")


def test_zero_overlap_means_disjoint_chunks():
    chunks = chunk_text(sentences(20), words, target_tokens=50, max_tokens=60, overlap_tokens=0)
    assert all(a.char_end <= b.char_start for a, b in zip(chunks, chunks[1:]))


def test_run_on_sentence_is_split_on_spaces():
    text = " ".join(["word"] * 250)  # no punctuation, no newlines
    chunks = chunk_text(text, words, target_tokens=50, max_tokens=60, overlap_tokens=0)
    assert all(c.token_count <= 60 for c in chunks)
    assert sum(c.token_count for c in chunks) == 250


def test_space_free_blob_is_hard_split_by_characters():
    chars = len  # fake tokenizer: one token per character
    chunks = chunk_text("x" * 1000, chars, target_tokens=100, max_tokens=120, overlap_tokens=0)
    assert all(c.token_count <= 120 for c in chunks)
    assert "".join(c.text for c in chunks) == "x" * 1000


def test_newlines_are_boundaries_even_without_punctuation():
    text = "\n".join(f"- item {i} " + "w " * 8 for i in range(30))  # a markdown list
    chunks = chunk_text(text, words, target_tokens=40, max_tokens=50, overlap_tokens=0)
    assert all(c.text.startswith("- item") for c in chunks)


def test_rejects_inconsistent_sizes():
    with pytest.raises(ValueError):
        chunk_text("x", words, target_tokens=100, max_tokens=50)
    with pytest.raises(ValueError):
        chunk_text("x", words, target_tokens=50, max_tokens=60, overlap_tokens=50)
