import pytest
from fpdf import FPDF

from app.parsers import UnsupportedFileType, detect_kind, parse


def test_detect_kind_prefers_extension():
    assert detect_kind("a.PDF", "text/plain") == "pdf"
    assert detect_kind("notes.markdown", None) == "markdown"
    assert detect_kind("blob", "application/pdf") == "pdf"
    with pytest.raises(UnsupportedFileType):
        detect_kind("image.png", "image/png")


def test_markdown_tracks_heading_path_and_ignores_fenced_hashes():
    md = "\n".join([
        "# Runbook",
        "Intro text.",
        "## Deploys",
        "### Rollback",
        "Run the script.",
        "```bash",
        "# not a heading",
        "```",
        "## Alerts",
        "Page on-call.",
    ])
    sections = parse(md.encode(), "markdown")
    assert [s.metadata["heading_path"] for s in sections] == [
        ["Runbook"],
        ["Runbook", "Deploys", "Rollback"],  # empty "Deploys" section is skipped
        ["Runbook", "Alerts"],
    ]
    assert "# not a heading" in sections[1].text


def test_text_strips_bom_and_skips_blank_files():
    [section] = parse("﻿hello".encode("utf-8"), "text")
    assert section.text == "hello" and section.metadata == {}
    assert parse(b"  \n ", "text") == []


def test_pdf_sections_carry_page_numbers_and_skip_blank_pages():
    pdf = FPDF()
    pdf.set_font("Helvetica", size=12)
    for body in ["First page text.", "", "Third page text."]:
        pdf.add_page()
        if body:
            pdf.cell(text=body)
    sections = parse(bytes(pdf.output()), "pdf")
    assert [(s.metadata["page"], s.text.strip()) for s in sections] == [
        (1, "First page text."),
        (3, "Third page text."),
    ]
