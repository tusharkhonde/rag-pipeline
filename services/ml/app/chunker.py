"""Token-aware chunking.

Algorithm:
  1. Split text into atoms: sentences and lines. An atom longer than max_tokens is split on
     spaces, and a single space-free run longer than that (e.g. a base64 blob) by characters.
  2. Pack atoms greedily until adding the next one would exceed target_tokens.
  3. Start each new chunk with the previous chunk's trailing atoms (up to overlap_tokens),
     so a fact straddling a boundary is fully present in at least one chunk.

Sizes are measured with an injected count_tokens function, which in production is the
embedding model's own tokenizer. The model silently truncates input past its limit,
so measuring in characters or words would let chunk tails go un-embedded.
"""

import re
from collections.abc import Callable
from dataclasses import dataclass

TokenCounter = Callable[[str], int]

# A boundary is a run of newlines, or whitespace following sentence-ending punctuation.
_ATOM_BOUNDARY = re.compile(r"\n+|(?<=[.!?])\s+")
_SPACE = re.compile(r"\s+")


@dataclass(frozen=True)
class Chunk:
    text: str
    token_count: int
    char_start: int  # offsets into the section text, so a UI could highlight the source span
    char_end: int


def chunk_text(
    text: str,
    count_tokens: TokenCounter,
    target_tokens: int = 450,
    max_tokens: int = 500,
    overlap_tokens: int = 64,
) -> list[Chunk]:
    if not 0 <= overlap_tokens < target_tokens <= max_tokens:
        raise ValueError("require 0 <= overlap_tokens < target_tokens <= max_tokens")

    atoms = [
        piece
        for span in _split(text, 0, len(text), _ATOM_BOUNDARY)
        for piece in _fit(text, span, count_tokens, max_tokens)
    ]
    if not atoms:
        return []

    chunks: list[Chunk] = []
    current: list[tuple[int, int]] = []
    for atom in atoms:
        if current and count_tokens(text[current[0][0] : atom[1]]) > target_tokens:
            chunks.append(_make_chunk(text, current, count_tokens))
            current = _overlap_tail(text, current, count_tokens, overlap_tokens)
            # If the carried-over overlap plus this atom would break the hard limit, drop the overlap.
            if current and count_tokens(text[current[0][0] : atom[1]]) > max_tokens:
                current = []
        current.append(atom)
    chunks.append(_make_chunk(text, current, count_tokens))
    return chunks


def _split(text: str, start: int, end: int, boundary: re.Pattern[str]) -> list[tuple[int, int]]:
    """Split text[start:end] at boundary matches into (start, end) spans, whitespace trimmed."""
    spans, cursor = [], start
    for match in boundary.finditer(text, start, end):
        spans.append((cursor, match.start()))
        cursor = match.end()
    spans.append((cursor, end))
    return [trimmed for s, e in spans if (trimmed := _trim(text, s, e))]


def _trim(text: str, start: int, end: int) -> tuple[int, int] | None:
    while start < end and text[start].isspace():
        start += 1
    while end > start and text[end - 1].isspace():
        end -= 1
    return (start, end) if start < end else None


def _fit(text: str, span: tuple[int, int], count_tokens: TokenCounter, max_tokens: int) -> list[tuple[int, int]]:
    """Return span as-is if it fits in max_tokens, else break it into pieces that do."""
    start, end = span
    if count_tokens(text[start:end]) <= max_tokens:
        return [span]
    words = _split(text, start, end, _SPACE)
    if len(words) > 1:
        # Re-pack words into the largest runs that fit, instead of one atom per word.
        pieces, run_start = [], words[0][0]
        for i, (w_start, w_end) in enumerate(words):
            if count_tokens(text[run_start:w_end]) > max_tokens and w_start > run_start:
                pieces.append((run_start, words[i - 1][1]))
                run_start = w_start
        pieces.append((run_start, end))
        return [p for piece in pieces for p in _fit(text, piece, count_tokens, max_tokens)]
    return _hard_split(text, start, end, count_tokens, max_tokens)


def _hard_split(text: str, start: int, end: int, count_tokens: TokenCounter, max_tokens: int) -> list[tuple[int, int]]:
    """Last resort for a single space-free run: binary-search the longest prefix that fits."""
    pieces = []
    while start < end:
        lo, hi = start + 1, end
        while lo < hi:
            mid = (lo + hi + 1) // 2
            if count_tokens(text[start:mid]) <= max_tokens:
                lo = mid
            else:
                hi = mid - 1
        pieces.append((start, lo))
        start = lo
    return pieces


def _overlap_tail(
    text: str, atoms: list[tuple[int, int]], count_tokens: TokenCounter, overlap_tokens: int
) -> list[tuple[int, int]]:
    """The longest run of trailing atoms that fits in overlap_tokens (never the whole chunk)."""
    tail: list[tuple[int, int]] = []
    for atom in reversed(atoms[1:]):
        if count_tokens(text[atom[0] : (tail[-1] if tail else atom)[1]]) > overlap_tokens:
            break
        tail.insert(0, atom)
    return tail


def _make_chunk(text: str, atoms: list[tuple[int, int]], count_tokens: TokenCounter) -> Chunk:
    start, end = atoms[0][0], atoms[-1][1]
    body = text[start:end]
    return Chunk(body, count_tokens(body), start, end)
