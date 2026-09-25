"""Turn raw uploaded bytes into Sections: runs of text that share one citation location.

A Section is the unit the chunker works within. Chunks never span two sections, so every
chunk maps to exactly one page (PDF) or one heading path (Markdown) for citations.
"""

import io
import re
from dataclasses import dataclass, field
from pathlib import PurePath
from typing import Literal

from pypdf import PdfReader

DocKind = Literal["pdf", "markdown", "text"]

_EXTENSIONS: dict[str, DocKind] = {
    ".pdf": "pdf",
    ".md": "markdown",
    ".markdown": "markdown",
    ".txt": "text",
}
_HEADING = re.compile(r"^(#{1,6})\s+(.+?)\s*#*\s*$")
_FENCE = re.compile(r"^\s*(```|~~~)")


class UnsupportedFileType(ValueError):
    pass


@dataclass(frozen=True)
class Section:
    text: str
    metadata: dict = field(default_factory=dict)  # {"page": 3} or {"heading_path": ["Deploys", "Rollback"]}


def detect_kind(filename: str, content_type: str | None) -> DocKind:
    # Trust the extension over the client-supplied Content-Type, which browsers often get wrong.
    kind = _EXTENSIONS.get(PurePath(filename).suffix.lower())
    if kind is None and content_type == "application/pdf":
        kind = "pdf"
    if kind is None:
        raise UnsupportedFileType(f"Unsupported file type: {filename!r} (accepted: .pdf, .md, .txt)")
    return kind


def parse(data: bytes, kind: DocKind) -> list[Section]:
    if kind == "pdf":
        return _parse_pdf(data)
    text = data.decode("utf-8-sig", errors="replace")  # -sig strips a UTF-8 BOM if present
    if kind == "markdown":
        return _parse_markdown(text)
    return [Section(text)] if text.strip() else []


def _parse_pdf(data: bytes) -> list[Section]:
    reader = PdfReader(io.BytesIO(data))
    sections = []
    for number, page in enumerate(reader.pages, start=1):
        text = page.extract_text() or ""
        # Scanned PDFs have no text layer; those pages come back empty (would need OCR).
        if text.strip():
            sections.append(Section(text, {"page": number}))
    return sections


def _parse_markdown(text: str) -> list[Section]:
    """Split at headings, tracking the heading hierarchy as a breadcrumb path."""
    sections: list[Section] = []
    path: list[tuple[int, str]] = []  # stack of (level, title)
    buffer: list[str] = []
    in_fence = False

    def flush() -> None:
        body = "\n".join(buffer).strip()
        if body:
            sections.append(Section(body, {"heading_path": [title for _, title in path]}))
        buffer.clear()

    for line in text.splitlines():
        if _FENCE.match(line):
            in_fence = not in_fence  # '# comment' inside a code block is not a heading
        match = None if in_fence else _HEADING.match(line)
        if match:
            flush()
            level = len(match.group(1))
            while path and path[-1][0] >= level:
                path.pop()
            path.append((level, match.group(2)))
        else:
            buffer.append(line)
    flush()
    return sections
