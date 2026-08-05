# Daytona isolates untrusted document extraction

Untrusted document bytes (PDF, Office, and related binaries) must not be opened
inside the credentialed main worker. Extraction for every current
`document-extract` ingest surface runs in a credential-thin extract service
that parses files inside ephemeral Daytona sandboxes (`networkBlockAll`, no
team secrets) and runs OpenRouter vision fallbacks in that service process
only when sandbox text is sparse or the input is an image.

## Context

Document upload, chat attachments, inbound email, and integration harvest all
enqueue `document-extract`. Historically the BullMQ worker downloaded bytes
into the same Node process that holds Postgres, Redis, S3, OpenRouter,
`SECRETS_ENCRYPTION_KEY`, and integration tokens, then ran
`@firecrawl/pdf-inspector` / mammoth in-process (or off-thread). That is a
reliability boundary, not a security boundary: a hostile PDF/DOCX can share
an address space with production secrets.

Third-party and multi-tenant ingest means we cannot assume every file was
authored by a trusted teammate.

## Decision

1. **Separate extract service.** Deploy the same `@timeline/worker` build with
   `WORKER_MODE=document-extract`. The full worker sets
   `DOCUMENT_EXTRACT_ENABLED=false` so only the extract service consumes the
   queue.
2. **Daytona sandbox + anydoc.** Untrusted binary formats are uploaded into a
   fresh sandbox created from a content-hashed snapshot
   `timeline-document-extract-<hash>` (1 CPU / 2 GB, `networkBlockAll`, no
   credentials). The sandbox runs Firecrawl **anydoc** (`firecrawl-anydoc`)
   to Markdown. Supported families include Word (`.doc`/`.docx`/`.docm`),
   PowerPoint, Excel, OpenDocument (`.odt`/`.ods`/`.odp`), RTF, EPUB, and
   text-based PDF. We do **not** call Firecrawl hosted `/parse` for team
   uploads.
3. **PDF vision stays in the extract service.** Sandboxes cannot call
   OpenRouter under `networkBlockAll`. When anydoc returns sparse / empty /
   unsupported (scanned) PDF text, pypdfium2 renders up to 20 pages
   (env-capped at 100) to PNG and the extract service runs
   `llm.extractTextFromMedia`. `image/*` inputs use the same vision path.
4. **Cheap UTF-8 for real text.** `text/*`, JSON/XML, and text-ish extensions
   (md/txt/csv/tsv/json/yaml/html/…) decode in-process without Daytona. CSV
   is never routed through anydoc.
5. **Credential boundary.** Extract service env is limited to Daytona, OpenRouter,
   Database, Redis, and S3 document-bucket access (`S3_ENDPOINT`, `S3_REGION`,
   access keys, `S3_BUCKET_DOCUMENTS`). In production
   `WORKER_MODE=document-extract`, `getEnv()` requires those credentials and
   enforces an allowlist against raw `process.env` so copied Railway vars
   (including unparsed secrets like `SLACK_CANARY_*`,
   `MCP_PREREGISTERED_*_CLIENT_SECRET`, `LANGSMITH_API_KEY`) cannot remain
   readable in the extract process.
6. **Local escape hatch.** Binary formats fail closed without Daytona unless
   `DOCUMENT_EXTRACT_ALLOW_INPROCESS=true` (or `1`; dev only — rejected when
   `NODE_ENV=production`). The hatch uses mammoth for DOCX and empty-PDF→vision;
   it does not run anydoc in the credentialed process. Production full workers
   must set `DOCUMENT_EXTRACT_ENABLED=false` (enforced in `apps/worker`
   entrypoint — not shared `getEnv()`, so production web can boot with the
   same defaults).
7. **Content-hashed snapshot lifecycle.** The snapshot name is derived from a
   hash of `apps/worker/document-extract-sandbox/**` (non-markdown files) plus
   an Image recipe revision constant. CI publishes/ensures that snapshot when
   those paths change; extract-main may create-once if missing
   (`DAYTONA_SNAPSHOT_ENSURE`, default true) but must not rebuild on every
   restart. Explicit `DAYTONA_SNAPSHOT` still overrides the hash pin.

## Snapshot operations

| Path | When | Command / behavior |
| --- | --- | --- |
| Content-hash name | Always (default) | `timeline-document-extract-<12-char-sha256>` from sandbox dir + image revision |
| Print name only | Local / CI | `pnpm --filter @timeline/worker create-document-extract-snapshot -- --print-name-only` |
| Ensure (idempotent) | Local once, CI on sandbox changes, optional extract boot | `pnpm --filter @timeline/worker create-document-extract-snapshot` (alias: `ensure-document-extract-snapshot`) |
| Force rebuild | Corruption / debugging | same script with `--force` |
| CI publish | Push to `main`/`staging` touching sandbox or snapshot recipe | `.github/workflows/publish-document-extract-snapshot.yml` when repo variable `DAYTONA_SNAPSHOT_PUBLISH=true` and secret `DAYTONA_API_KEY` |
| Boot ensure | extract-main start | If `DAYTONA_SNAPSHOT_ENSURE=true` (default) and `DAYTONA_API_KEY` set: get-or-create once |

Recommended Railway pin after CI (or leave unset / `auto` so the worker resolves the hash from the shipped sandbox directory):

```bash
DAYTONA_SNAPSHOT=timeline-document-extract-<hash>
```

## Non-goals

- Firecrawl hosted Parse / OCR API for team uploads.
- Audio / `transcribe` / ffmpeg isolation (later).
- Video ingest.
- Meeting-bot raw audio (Recall transcripts only; unchanged).
- Fact extraction (`extract` queue) — operates on already-text events.
- Daytona warm pools and per-document fingerprint skip-reuse.
- Running anydoc in web or full-worker address space.

## Consequences

- Main worker no longer loads untrusted PDF/Office parsers on the hot path.
- Extract service still has DB write + S3 read + OpenRouter; compromise is
  narrower than full worker secret theft but not zero.
- Operators set `DAYTONA_*` on the extract service. Snapshot drift is avoided
  by content-hash names + CI ensure; first boot without a published snapshot
  may be slow when boot ensure creates it. Sandbox/deps changes (including
  anydoc pins) require a new content-hashed snapshot.
- Document product behavior (chunking, embed fan-out, failed/retry UX, 25 MiB
  cap) stays the same; only the trust boundary and format coverage move.
