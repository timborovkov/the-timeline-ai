# Daytona isolates untrusted document extraction

Untrusted document bytes (PDF, Office, and related binaries) must not be opened
inside the credentialed main worker. Extraction for every current
`document-extract` ingest surface runs through a credential-thin Railway
orchestrator service named `document-extract-orchestrator`. It parses files
inside ephemeral Daytona sandboxes (`networkBlockAll`, no team secrets) and
runs OpenRouter vision fallbacks in the orchestrator process only when sandbox
text is sparse or the input is an image.

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

1. **Separate extract orchestrator.** Deploy the same `@timeline/worker` build
   as the Railway service `document-extract-orchestrator` with
   `WORKER_MODE=document-extract`. The full worker sets
   `DOCUMENT_EXTRACT_ENABLED=false` so only the orchestrator consumes the queue.
2. **Daytona sandbox + anydoc.** Untrusted binary formats are uploaded into a
   fresh sandbox created from a content-hashed snapshot
   `timeline-document-extract-<hash>` (1 CPU / 2 GB, `networkBlockAll`, no
   credentials). The sandbox runs Firecrawl **anydoc** (`firecrawl-anydoc`)
   to Markdown. Supported families include Word (`.doc`/`.docx`/`.docm`),
   PowerPoint, Excel, OpenDocument (`.odt`/`.ods`/`.odp`), RTF, EPUB, and
   text-based PDF. We do **not** call Firecrawl hosted `/parse` for team
   uploads.
3. **PDF vision stays in the orchestrator.** Sandboxes cannot call
   OpenRouter under `networkBlockAll`. Native text coverage is checked per
   page, so a mixed PDF cannot hide scanned pages behind one dense text page.
   When anydoc returns sparse / empty / unsupported PDF text, pypdfium2 plus
   Pillow renders up to 20 pages (env-capped at 100) to PNG and the extract
   orchestrator runs `llm.extractTextFromMedia`. Before download, every remote PNG
   is capped at 8 MiB and the complete set at 32 MiB; larger sets use the
   compressed full-PDF vision path instead of accumulating rendered buffers.
   `image/*` inputs use the same vision path.
4. **Cheap UTF-8 for real text.** `text/*`, JSON/XML, and text-ish extensions
   (md/txt/csv/tsv/json/yaml/html/…) decode in-process without Daytona. CSV
   is never routed through anydoc.
5. **Credential boundary.** The orchestrator env is limited to Daytona,
   OpenRouter, Database, Redis, and S3 document-bucket access (`S3_ENDPOINT`,
   `S3_REGION`, access keys, `S3_BUCKET_DOCUMENTS`). In production
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
   restart. Railway uses `DAYTONA_SNAPSHOT=auto` so deployed code and snapshot
   inputs cannot drift. After publish, CI retains the current hash plus two
   rollback hashes. It deletes only exact content-hashed names that have no
   Daytona sandbox references; legacy and unrelated snapshots are never
   automated deletion targets.

## Snapshot operations

| Path | When | Command / behavior |
| --- | --- | --- |
| Content-hash name | Always (default) | `timeline-document-extract-<12-char-sha256>` from sandbox dir + image revision |
| Print name only | Local / CI | `pnpm --filter @timeline/worker create-document-extract-snapshot -- --print-name-only` |
| Ensure (idempotent) | Local once, CI on sandbox changes, optional extract boot | `pnpm --filter @timeline/worker create-document-extract-snapshot` (alias: `ensure-document-extract-snapshot`) |
| Force rebuild | Corruption / debugging | same script with `--force` |
| CI publish | Push to `main`/`staging` touching sandbox or snapshot recipe | `.github/workflows/publish-document-extract-snapshot.yml` when repo variable `DAYTONA_SNAPSHOT_PUBLISH=true` and secret `DAYTONA_API_KEY` |
| CI retention | After a successful publish | `pnpm --filter @timeline/worker cleanup-document-extract-snapshots -- --retain=3`; skips sandbox-referenced snapshots and ignores non-hashed names |
| Boot ensure | extract-main start | If `DAYTONA_SNAPSHOT_ENSURE=true` (default) and `DAYTONA_API_KEY` set: get-or-create once |

Recommended Railway setting (the worker resolves the hash from the shipped sandbox directory):

```bash
DAYTONA_SNAPSHOT=auto
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
- The orchestrator still has DB write + S3 read + OpenRouter; compromise is
  narrower than full worker secret theft but not zero.
- Operators set `DAYTONA_*` on `document-extract-orchestrator`. Snapshot drift is avoided
  by content-hash names + `DAYTONA_SNAPSHOT=auto`; first boot without a published snapshot
  may be slow when boot ensure creates it. CI bounds retained content-hashed
  snapshots to three while preserving any snapshot referenced by a sandbox.
  Sandbox/deps changes (including
  anydoc, pypdfium2, or Pillow pins) require a new content-hashed snapshot.
- Document product behavior (chunking, embed fan-out, failed/retry UX, 25 MiB
  cap) stays the same; only the trust boundary and format coverage move.
