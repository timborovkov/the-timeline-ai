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
# Phase 6: model used by /api/chat. Lets us point chat at a stronger
# model than extraction without changing extraction behavior. Falls back
# to CHAT_MODEL_DEFAULT when unset.
AGENT_MODEL=anthropic/claude-3.7-sonnet
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

## Phase 5 verification (embeddings + semantic search)

After `OPENROUTER_API_KEY`, `REDIS_URL`, and `QDRANT_URL` are set, with the
docker stack (`docker compose up -d`) running and both `pnpm dev` (web) and
the worker process started:

1. Post 2–3 text notes on `/app/timeline`, e.g.
   `Met with John Ternus at Apple about SaaS licensing.` and
   `Caught up with Apple folks on the agreement structure.`
2. The extract worker writes facts; the embed worker writes one Qdrant point
   per fact plus one per raw event. Confirm via:
   ```bash
   curl -s "$QDRANT_URL/collections/events" | jq '.result.points_count'
   ```
3. Use the search bar on `/app/timeline` and query
   `licensing discussion with Apple`. The events above rank in the top results
   even though one does not contain the word "licensing".
4. Mark a note as `private` in the capture form before posting. The embed
   worker stamps `embedding_skipped_reason=visibility=private` on
   `source_metadata` and writes nothing to Qdrant. Teammates running the
   same query do not see the private row in their search results — the
   Qdrant wrapper's filter and `withTeam`'s second-line check both drop it.

Without `OPENROUTER_API_KEY` or `QDRANT_URL`, `/api/search` returns 503 and
the search bar shows "Search is not configured for this environment". Notes
still capture; embeddings are deferred until config + reembed.

## Phase 6 verification (agent chat)

Phase 6 adds `/app/chat` — a streaming, tool-using agent over the Phase 5
timeline. Every claim cites the raw event via inline `[ev:<uuid>]` chips.
The chat endpoint requires both `OPENROUTER_API_KEY` (for the model) and
`QDRANT_URL` (the agent's `search_timeline` tool); without either,
`/api/chat` returns 503 `chat_unconfigured` and the UI surfaces a real
error instead of looping the agent against a broken backend.

Optional env knob: `AGENT_MODEL` lets you point chat at a stronger model
than extraction without changing extraction behavior. Resolution chain:
`AGENT_MODEL ?? CHAT_MODEL_DEFAULT ?? openai/gpt-4o-mini`.

After Phase 5 verification works end-to-end (events embedded, search bar
returns hits), open `/app/chat` and run the three brief queries:

1. **"What did the team work on yesterday?"** — exercises `list_events`
   with a date filter. Expect a bulleted list where every bullet ends
   with `[ev:<uuid>]`. Clicking a chip jumps to that event in the
   timeline via `#ev-<uuid>` anchor.
2. **"What was discussed with John Ternus last time?"** — exercises
   `get_entity` + `search_timeline`. The chat pane shows two visible
   tool-step chips ("Looked up entity 'John Ternus'", "Searched timeline
   for …") above the assistant's reply.
3. **"What's outstanding for Acme?"** — the agent infers from event
   content; every inference still carries a citation.

Adversarial checks worth running once:

- Paste a UUID known to belong to another team. The agent calls
  `get_event`, the tool returns `{ found: false }`, and the assistant
  says "I don't have an event with that id" — never the cross-team row.
- Ask about a team that isn't yours. The agent answers from your active
  team only; switching teams via the team switcher swaps the agent's
  context.

The agent is capped at 5 tool turns per turn. Tool errors are caught
inside `execute` and returned as `{ error: 'tool_failed' }` so the
stream stays alive — the agent recovers or reports failure with a
citation-aware message rather than crashing the response.

## Re-embed procedure (when changing `EMBEDDING_MODEL` or `EMBEDDING_DIMENSIONS`)

The embedding model is pinned. Changing it invalidates every vector in the
existing collection — semantic search would silently degrade as old and new
embeddings drift apart in vector space. The cutover below keeps the old
collection alive (read-only) while the new one is populated, then flips
reads atomically via the `QDRANT_COLLECTION` env var.

1. **Update env** in `.env` (and staging/production):
   ```bash
   EMBEDDING_MODEL=openai/text-embedding-3-large
   EMBEDDING_DIMENSIONS=3072
   ```
   Leave `QDRANT_COLLECTION=events` unchanged — the worker keeps writing to
   the current collection until step 5.

2. **Create the new collection** with the new vector size. This step is
   **mandatory** — the embed worker uses `requireExisting=true` when a
   `targetCollection` is on the job, so a stale worker process started
   before the env change cannot silently auto-create the new collection at
   the OLD dimension and corrupt the cutover. The worker errors loudly if
   the collection is missing.
   ```bash
   curl -s -X PUT "$QDRANT_URL/collections/events_v2" \
     -H "content-type: application/json" \
     -H "api-key: $QDRANT_API_KEY" \
     -d '{"vectors":{"size":3072,"distance":"Cosine"}}'
   ```

3. **Re-embed each team** into the new collection. The worker reads
   `targetCollection` from the job payload and writes there instead of
   `QDRANT_COLLECTION`. The old collection is untouched.
   ```bash
   pnpm --filter @timeline/worker reembed -- \
     --team=<teamId> \
     --target-collection=events_v2
   ```
   Re-running is idempotent — point ids derived from
   `(scope, sourceId, embedding_model)` are deterministic, so the same row
   maps to the same point id and Qdrant upserts naturally.

4. **Verify** spot-checks against the new collection by overriding
   `QDRANT_COLLECTION` in a single shell before flipping production:
   ```bash
   QDRANT_COLLECTION=events_v2 pnpm --filter @timeline/web dev
   ```

5. **Cut over** by setting `QDRANT_COLLECTION=events_v2` everywhere and
   restarting web + workers. The flip is atomic from the reader's
   perspective — the next request hits the new collection.

6. **Drop the old collection** after a grace period (a day is plenty;
   rollback is just flipping `QDRANT_COLLECTION` back):
   ```bash
   curl -s -X DELETE "$QDRANT_URL/collections/events" \
     -H "api-key: $QDRANT_API_KEY"
   ```

This procedure is the **only** safe path. Never edit embeddings in place —
embedding-model drift silently corrupts semantic search, and "looks ok in
prod" is not a reliable signal until queries start ranking the wrong things.
