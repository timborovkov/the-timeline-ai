# Document-extract Daytona snapshot

Tools baked into the content-hashed Daytona snapshot
`timeline-document-extract-<hash>` (ADR 0013).

- `extract_anydoc.py` — Firecrawl anydoc → Markdown for office + text PDFs;
  sparse / scanned PDFs render page PNGs via pypdfium2 for host vision
- `requirements.txt` — pinned `firecrawl-anydoc` + `pypdfium2`

No hosted Firecrawl `/parse`. Sandboxes run with `networkBlockAll`.

## Lifecycle

Snapshot names are derived from a hash of this directory (markdown ignored)
plus the Image recipe revision in
`apps/worker/src/document-ingestion/document-extract-snapshot.ts`.

```bash
set -a; . ./.env; set +a

# Print the name for this commit (no Daytona API call):
pnpm --filter @timeline/worker create-document-extract-snapshot -- --print-name-only

# Create if missing (idempotent; preferred):
pnpm --filter @timeline/worker create-document-extract-snapshot

# Force delete + recreate (debug / corruption only):
pnpm --filter @timeline/worker create-document-extract-snapshot -- --force
```

Requires `DAYTONA_API_KEY` (and optional `DAYTONA_API_URL` / `DAYTONA_TARGET`).
Override the hashed name with `DAYTONA_SNAPSHOT=<name>` when you need a fixed pin.

CI: `.github/workflows/publish-document-extract-snapshot.yml` ensures the
snapshot on pushes that touch this directory (when
`DAYTONA_SNAPSHOT_PUBLISH=true`). Extract-main can also ensure-once at boot
(`DAYTONA_SNAPSHOT_ENSURE`, default true) — it does not rebuild every restart.
