# Daytona isolates untrusted document extraction

Untrusted document bytes (PDF, DOCX, and related binaries) must not be opened
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
2. **Daytona sandbox for parsers.** PDF/DOCX bytes are uploaded into a fresh
   sandbox created from snapshot `timeline-document-extract` (1 CPU / 2 GB,
   `networkBlockAll`, no credentials). Python tries pdfplumber → pypdfium2;
   sparse text (< 500 chars) renders up to 20 pages (env-capped at 100) to
   PNG. DOCX text is extracted in the same sandbox.
3. **Vision stays in the extract service.** Sandboxes cannot call OpenRouter
   under `networkBlockAll`. Sparse PDF page images and `image/*` inputs are
   transcribed via `llm.extractTextFromMedia` in the extract service Node
   process.
4. **Credential boundary.** Extract service env is limited to Daytona, OpenRouter,
   Database, Redis, and S3 document-bucket access. It must not carry
   `SECRETS_ENCRYPTION_KEY`, Auth.js secrets, or integration/chat provider
   tokens. In production `WORKER_MODE=document-extract`, `getEnv()` rejects
   those secrets if set and requires Daytona, OpenRouter, Redis, and S3
   document-bucket credentials at boot.
5. **Local escape hatch.** PDF/DOCX fail closed without Daytona unless
   `DOCUMENT_EXTRACT_ALLOW_INPROCESS=true` (or `1`; dev only — rejected when
   `NODE_ENV=production`). A full worker with `DOCUMENT_EXTRACT_ENABLED=true`
   but no Daytona key skips the document-extract consumer rather than falling
   through to in-process vision on credentialed hosts.

## Non-goals

- Audio / `transcribe` / ffmpeg isolation (later).
- Video ingest.
- Meeting-bot raw audio (Recall transcripts only; unchanged).
- Fact extraction (`extract` queue) — operates on already-text events.
- Daytona warm pools and content-addressed fingerprint skip-reuse.

## Consequences

- Main worker no longer loads untrusted PDF/DOCX parsers on the hot path.
- Extract service still has DB write + S3 read + OpenRouter; compromise is
  narrower than full worker secret theft but not zero.
- Operators must maintain the Daytona snapshot and set `DAYTONA_*` on the
  extract service (and locally when not using the in-process escape hatch).
- Document product behavior (chunking, embed fan-out, failed/retry UX, 25 MiB
  cap) stays the same; only the trust boundary moves.
