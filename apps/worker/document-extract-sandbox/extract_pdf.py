#!/usr/bin/env python3
"""Isolated PDF text extraction for Timeline document-extract sandboxes.

Tries pdfplumber (layout=True), falls back to pypdfium2 on throw, and when
total text is below --sparse-chars renders up to --max-pages PNGs for the
host vision fallback. Prints a single JSON object to stdout.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


def extract_pdfplumber(path: Path) -> tuple[str, int]:
    import pdfplumber

    parts: list[str] = []
    with pdfplumber.open(str(path)) as pdf:
        page_count = len(pdf.pages)
        for page in pdf.pages:
            text = page.extract_text(layout=True) or ""
            if text.strip():
                parts.append(text)
    return "\n\n".join(parts).strip(), page_count


def extract_pypdfium2(path: Path) -> tuple[str, int]:
    import pypdfium2 as pdfium

    pdf = pdfium.PdfDocument(str(path))
    try:
        page_count = len(pdf)
        parts: list[str] = []
        for i in range(page_count):
            page = pdf[i]
            textpage = page.get_textpage()
            try:
                text = textpage.get_text_bounded() or ""
            finally:
                textpage.close()
                page.close()
            if text.strip():
                parts.append(text)
        return "\n\n".join(parts).strip(), page_count
    finally:
        pdf.close()


def render_pages(path: Path, out_dir: Path, max_pages: int) -> tuple[list[str], int]:
    import pypdfium2 as pdfium

    out_dir.mkdir(parents=True, exist_ok=True)
    pdf = pdfium.PdfDocument(str(path))
    try:
        page_count = len(pdf)
        limit = min(page_count, max_pages)
        paths: list[str] = []
        for i in range(limit):
            page = pdf[i]
            try:
                bitmap = page.render(scale=2)
                pil_image = bitmap.to_pil()
                out_path = out_dir / f"page-{i + 1:04d}.png"
                pil_image.save(out_path, format="PNG")
                paths.append(str(out_path))
            finally:
                page.close()
        return paths, page_count
    finally:
        pdf.close()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--out-dir", required=True)
    parser.add_argument("--sparse-chars", type=int, default=500)
    parser.add_argument("--max-pages", type=int, default=20)
    args = parser.parse_args()

    input_path = Path(args.input)
    out_dir = Path(args.out_dir)
    max_pages = max(1, min(int(args.max_pages), 100))
    sparse_chars = max(0, int(args.sparse_chars))

    method = "pdfplumber"
    text = ""
    page_count = 0
    error: str | None = None

    try:
        text, page_count = extract_pdfplumber(input_path)
    except Exception as exc:  # noqa: BLE001 — sandbox must always emit JSON
        method = "pypdfium2"
        error = f"pdfplumber: {exc}"
        try:
            text, page_count = extract_pypdfium2(input_path)
            error = None
        except Exception as exc2:  # noqa: BLE001
            error = f"{error}; pypdfium2: {exc2}"
            text = ""
            page_count = 0

    page_images: list[str] = []
    if len(text.strip()) < sparse_chars:
        try:
            page_images, rendered_count = render_pages(input_path, out_dir / "pages", max_pages)
            if page_count == 0:
                page_count = rendered_count
            method = f"{method}+render" if text.strip() else "render"
        except Exception as exc:  # noqa: BLE001
            error = f"{error + '; ' if error else ''}render: {exc}"

    result = {
        "ok": error is None or bool(text.strip()) or bool(page_images),
        "method": method,
        "text": text,
        "pageCount": page_count,
        "pageImagePaths": page_images,
        "sparse": len(text.strip()) < sparse_chars,
        "error": error,
    }
    json.dump(result, sys.stdout)
    sys.stdout.write("\n")
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
