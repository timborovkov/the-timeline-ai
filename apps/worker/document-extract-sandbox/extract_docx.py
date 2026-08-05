#!/usr/bin/env python3
"""Isolated DOCX text extraction for Timeline document-extract sandboxes."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Iterator


def iter_block_items(document) -> Iterator[object]:
    """Yield paragraphs and tables in document-body order."""
    from docx.oxml.table import CT_Tbl
    from docx.oxml.text.paragraph import CT_P
    from docx.table import Table
    from docx.text.paragraph import Paragraph

    body = document.element.body
    for child in body.iterchildren():
        if isinstance(child, CT_P):
            yield Paragraph(child, document)
        elif isinstance(child, CT_Tbl):
            yield Table(child, document)


def table_lines(table) -> list[str]:
    lines: list[str] = []
    for row in table.rows:
        cells = [(cell.text or "").strip() for cell in row.cells]
        line = " | ".join(cell for cell in cells if cell)
        if line:
            lines.append(line)
    return lines


def extract_docx(path: Path) -> str:
    from docx import Document
    from docx.table import Table
    from docx.text.paragraph import Paragraph

    document = Document(str(path))
    parts: list[str] = []
    for block in iter_block_items(document):
        if isinstance(block, Paragraph):
            text = (block.text or "").strip()
            if text:
                parts.append(text)
        elif isinstance(block, Table):
            parts.extend(table_lines(block))
    return "\n".join(parts).strip()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    args = parser.parse_args()

    try:
        text = extract_docx(Path(args.input))
        json.dump({"ok": True, "text": text, "error": None}, sys.stdout)
        sys.stdout.write("\n")
        return 0
    except Exception as exc:  # noqa: BLE001
        json.dump({"ok": False, "text": "", "error": str(exc)}, sys.stdout)
        sys.stdout.write("\n")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
