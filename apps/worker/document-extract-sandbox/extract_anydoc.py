#!/usr/bin/env python3
"""Isolated document extraction for Timeline Daytona sandboxes (ADR 0013).

Uses Firecrawl anydoc (`firecrawl-anydoc`) for office + text-based PDFs.
Scanned / sparse PDFs fall back to pypdfium2 page PNG renders for the
credential-thin extract service's vision path. Never calls hosted Parse.

Prints a single JSON object to stdout.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


def _normalize_title(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    title = value.strip()
    return title or None


def extract_pdf_title(path: Path) -> str | None:
    """Best-effort PDF metadata Title for dense text extracts."""
    try:
        import pypdfium2 as pdfium

        pdf = pdfium.PdfDocument(str(path))
        try:
            meta = (
                pdf.get_metadata_dict(skip_empty=True)
                if hasattr(pdf, "get_metadata_dict")
                else {}
            )
            if isinstance(meta, dict):
                title = _normalize_title(meta.get("Title") or meta.get("title"))
                if title:
                    return title
        finally:
            pdf.close()
    except Exception:  # noqa: BLE001 — title is optional
        pass
    return None


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


def _error_label(exc: BaseException) -> str:
    name = type(exc).__name__
    message = str(exc).strip()
    return f"{name}: {message}" if message else name


def convert_with_anydoc(path: Path, format_hint: str | None) -> tuple[str, str | None]:
    """Return (markdown, error_label). error_label set on conversion failure."""
    import anydoc

    try:
        data = path.read_bytes()
        # to_markdown(path) sniffs content; bytes + format covers CSV-like
        # cases and mislabeled extensions.
        if format_hint:
            text = anydoc.to_markdown_bytes(data, format_hint)
        else:
            detected = anydoc.format_from_bytes(data)
            text = (
                anydoc.to_markdown_bytes(data, detected)
                if detected
                else anydoc.to_markdown(str(path))
            )
        return (text or "").strip(), None
    except Exception as exc:  # noqa: BLE001 — always emit JSON
        return "", _error_label(exc)


def is_pdf(path: Path, format_hint: str | None) -> bool:
    if format_hint and format_hint.lower() == "pdf":
        return True
    if path.suffix.lower() == ".pdf":
        return True
    try:
        head = path.read_bytes()[:5]
        return head == b"%PDF-"
    except OSError:
        return False


def extract_pdf(
    path: Path,
    out_dir: Path,
    sparse_chars: int,
    max_pages: int,
    format_hint: str | None,
) -> dict[str, object]:
    text, convert_error = convert_with_anydoc(path, format_hint or "pdf")
    method = "anydoc"
    error = convert_error
    page_count = 0
    page_images: list[str] = []

    sparse = len(text) < sparse_chars
    if sparse:
        try:
            page_images, page_count = render_pages(path, out_dir / "pages", max_pages)
            method = f"{method}+render" if text else "render"
            # Image-only / unsupported anydoc is expected for scanned PDFs.
            if convert_error and page_images:
                error = None
        except Exception as exc:  # noqa: BLE001
            render_err = f"render: {exc}"
            error = f"{error}; {render_err}" if error else render_err

    title = extract_pdf_title(path)
    ok = bool(text) or bool(page_images) or sparse
    return {
        "ok": ok and (error is None or bool(text) or bool(page_images) or sparse),
        "method": method,
        "text": text,
        "pageCount": page_count,
        "pageImagePaths": page_images,
        "sparse": sparse,
        "title": title,
        "error": error,
    }


def extract_office(path: Path, format_hint: str | None) -> dict[str, object]:
    text, error = convert_with_anydoc(path, format_hint)
    ok = bool(text) and error is None
    if text and error is None:
        ok = True
    elif text:
        # Partial text with a soft warning — still usable.
        ok = True
    else:
        ok = False
    return {
        "ok": ok,
        "method": "anydoc",
        "text": text,
        "pageCount": 0,
        "pageImagePaths": [],
        "sparse": False,
        "title": None,
        "error": error,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--out-dir", required=True)
    parser.add_argument("--sparse-chars", type=int, default=500)
    parser.add_argument("--max-pages", type=int, default=20)
    parser.add_argument(
        "--format",
        default="",
        help="Optional anydoc format hint (pdf, docx, pptx, …)",
    )
    args = parser.parse_args()

    input_path = Path(args.input)
    out_dir = Path(args.out_dir)
    max_pages = max(1, min(int(args.max_pages), 100))
    sparse_chars = max(0, int(args.sparse_chars))
    format_hint = args.format.strip().lower() or None

    if is_pdf(input_path, format_hint):
        result = extract_pdf(input_path, out_dir, sparse_chars, max_pages, format_hint)
    else:
        result = extract_office(input_path, format_hint)

    json.dump(result, sys.stdout)
    sys.stdout.write("\n")
    return 0 if result.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())
