# Document-extract Daytona snapshot

Python tools baked into the `timeline-document-extract` Daytona snapshot.

- `extract_pdf.py` — pdfplumber → pypdfium2 → sparse page PNG render
- `extract_docx.py` — python-docx plain text
- `requirements.txt` — pinned sandbox deps

Create or refresh the snapshot:

```bash
set -a; . ./.env; set +a
pnpm --filter @timeline/worker create-document-extract-snapshot
```

Requires `DAYTONA_API_KEY` (and optional `DAYTONA_API_URL` / `DAYTONA_TARGET`).
