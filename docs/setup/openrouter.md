# OpenRouter setup

> Used from **Phase 3** (transcription) and onwards.

OpenRouter is a single provider for chat, embeddings, and transcription. The
internal LLM wrapper (`packages/shared/llm`) talks to it via the OpenAI SDK
shape.

## 1. Account + API key

1. Sign up at <https://openrouter.ai>.
2. Add credits (test with $5).
3. Create an API key (Settings → Keys).

Set in `.env`:

```bash
OPENROUTER_API_KEY=sk-or-v1-...
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
```

## 2. Model pins

The embedding model is pinned. Changing it invalidates the entire vector
index — re-embed before changing.

```bash
EMBEDDING_MODEL=openai/text-embedding-3-small
EMBEDDING_DIMENSIONS=1536
TRANSCRIPTION_MODEL=openai/whisper-1
CHAT_MODEL_DEFAULT=anthropic/claude-3.7-sonnet
# Phase 4: cheap model used by the extract worker. Falls back to
# CHAT_MODEL_DEFAULT when unset.
EXTRACTION_MODEL=openai/gpt-4o-mini
```

## 3. Quick smoke test

```bash
curl https://openrouter.ai/api/v1/chat/completions \
  -H "Authorization: Bearer $OPENROUTER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"openai/gpt-4o-mini","messages":[{"role":"user","content":"ping"}]}'
```

## Phase 3 verification (transcription)

After setting `OPENROUTER_API_KEY` and starting `pnpm dev`:

1. Record a ~5s voice memo via the web recorder on `/app/timeline`.
2. The row appears immediately with an audio player and a "Transcribing…"
   placeholder. The BullMQ `transcribe` worker pulls the bytes from
   RustFS, POSTs to `${OPENROUTER_BASE_URL}/audio/transcriptions` with
   the pinned `TRANSCRIPTION_MODEL`, and writes the result back onto
   `content_text`.
3. Refresh — the transcript appears.

Without the key set, voice notes still record and play back; the
transcribe job retries until the key is available (BullMQ default
exponential backoff, 3 attempts).

## Phase 4 verification (extraction + entities)

After `OPENROUTER_API_KEY` and `REDIS_URL` are set, with `pnpm dev` (web) and
the worker process running:

1. Post a text note on `/app/timeline` such as
   `Met with John Ternus at Apple about SaaS licensing.`
2. Within a few seconds the extract worker should write rows into the new
   `facts` and `entities` tables.
3. Visit `/app/entities` — `John Ternus` (person), `Apple` (company), and
   `SaaS licensing` (topic) appear, grouped by type.
4. Click into any of them to see the aggregated source events, the
   confidence-scored fact statements, and the co-occurring entity sidebar.

Without `OPENROUTER_API_KEY`, the text and voice notes still land on the
timeline. The extract worker fails (no key), and after retries are exhausted
the raw event row gets `source_metadata.extraction_failed_at` /
`extraction_error` set. Provide the key and run the re-extraction script
below to backfill.

### Entity resolution scope (Phase 4)

Resolution is deterministic name + alias matching within a team. Two
limitations to know about:

- **No fuzzy / embedding-based dedup.** "Apple" and "Apple Inc" land as two
  rows unless one already lists the other as an alias. Use the admin merge
  UI on `/app/entities/[id]` to fold one into the other; aliases combine
  and all `fact_entities` references rewrite atomically.
- **Same name, different team = different entity.** Entity rows are
  team-scoped by design. Cross-team resolution is intentionally out of
  scope.

Phase 5+ may add embedding similarity once vectors exist; until then, merges
are manual.

### Re-extraction procedure (when changing the extraction prompt or model)

The `model_version` written on each fact combines `EXTRACTION_MODEL` with an
internal code-revision tag. When either changes, replay raw events:

1. Update `EXTRACTION_MODEL` in env if needed.
2. Run for one team:
   ```bash
   pnpm --filter @timeline/worker reextract -- --team=<teamId>
   ```
3. The script walks every raw event for the team, skips rows that already
   have facts at the current `model_version`, and enqueues an `extract`
   job for the rest. The worker is independently idempotent — re-running
   the script is safe.

This is intentionally **manual**: extraction is the first place we burn
tokens at scale, and silent auto-replay would surprise the bill.

## Re-embed procedure (when changing `EMBEDDING_MODEL`)

1. Update `EMBEDDING_MODEL` and `EMBEDDING_DIMENSIONS` in env.
2. Create a new Qdrant collection at the new size.
3. Run `pnpm --filter @timeline/worker reembed -- --collection=<new>`.
4. Cut over read path to the new collection.
5. Drop the old collection.

This procedure is the only safe path. Never edit embeddings in place.
