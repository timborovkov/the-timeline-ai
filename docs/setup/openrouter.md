# OpenRouter setup


OpenRouter is the shared provider for Timeline-controlled chat, embeddings, vision OCR, and non-meeting voice-note transcription. Chat, embeddings, and vision OCR route through the Vercel AI SDK OpenAI-compatible provider; production voice-note transcription calls OpenRouter's JSON audio endpoint through the same internal LLM wrapper. Recall meeting transcription is a separate provider pipeline. The code-owned registry classifies each OpenRouter role as ZDR-required or as a disclosed retained, no-training quality exception. Production must carry the generated attestation for the exact inference key, guardrail, catalog, and policy.

<span id="account"></span>

## 1. Account + API key

1.  Sign up at <https://openrouter.ai>.
2.  Add credits (test with \$5).
3.  Restrict the production key to every exact model id in `packages/shared/src/llm/models.ts`. Enable the applicable zero-data-retention guardrail for every model classified `zdr_required`. Keep prompt logging, model-improvement input/output sharing, and Broadcast disabled, and verify that [response caching](https://openrouter.ai/docs/guides/features/response-caching) or cache-enabling presets have not been enabled for the production key.
4.  Create one shared production API key (Settings → Keys), assign the applicable guardrails, and bind the exact catalog allowlist to it. Do not split roles across untracked keys.
5.  Record a dated export or screenshot of the privacy settings and key-to-guardrail mapping. Execute the applicable DPA and retain the current subprocessor/model-provider evidence for the deployed tier.
6.  From an operator-only environment, use an OpenRouter management key to verify the guardrail settings, `allowed_models`, and the exact inference-key assignment. Save the dated response as deployment evidence. Never put the management key in the web, worker, document-extract, or Railway runtime environment.

Set in `.env`:

    OPENROUTER_API_KEY=sk-or-v1-...
    OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
    OPENROUTER_GUARDRAIL_ID=<official guardrail id>
    OPENROUTER_PRIVACY_POLICY_ATTESTATION=<generated orpa1 token>

This official-origin, official-guardrail, and generated-attestation contract applies to `TIMELINE_DEPLOYMENT_MODE=hosted`. An explicitly self-managed production operator may use its own OpenRouter-compatible endpoint without these hosted attestation variables, but owns the endpoint, privacy controls, retention, evidence, and user notice and must not reuse Timeline-hosted provider assurances.

After the separate provider-side check, generate the non-secret token with `bun run openrouter:attestation -- --env-file=/absolute/path/to/operator.env`. The file needs only `OPENROUTER_API_KEY` and `OPENROUTER_GUARDRAIL_ID` and should remain outside the repository. The command prints only the `OPENROUTER_PRIVACY_POLICY_ATTESTATION=...` assignment, never the key. Hosted production validation fails closed when the token does not match the current policy version, model-catalog digest, inference-key fingerprint, and guardrail id. The token detects local drift; it does not prove the provider-side assignment or settings, which still require the management-key deployment check and dated evidence. ZDR-required requests send `provider.data_collection=deny`, `provider.zdr=true`, and an explicit cache-disable control on every API surface that supports them. OpenRouter's [ZDR documentation](https://openrouter.ai/docs/guides/features/zdr) says those endpoints cannot train on request data, although transient processing and in-memory prompt caching can still occur. Recheck the controls whenever the key, catalog, or privacy-policy version changes. Regenerate the token after any key, guardrail, catalog, or policy change.

<span id="model-pins"></span>

## 2. Model pins

Embedding workers leave provider timeouts (including “timed out” responses) to the
queue retry policy. They do not split batches on a timeout, even on the final
attempt; splitting is reserved for batch-size failures and eligible ambiguous
API failures. Exhausted embedding timeouts remain visible as terminal failures
in [worker monitoring](sentry.md).

Model selection is code-owned in `packages/shared/src/llm/models.ts`. Keep extraction, agent, summarization, vision, embedding, and transcription model ids there together with their privacy class, context windows, capabilities, and embedding dimensions. The environment supplies the OpenRouter key, official base URL, guardrail id, and generated key/guardrail/catalog/policy attestation; model choice remains code-owned.

Structured extraction calls use DeepSeek V4.1 Flash 1017 as the primary route. If the provider accepts the request but returns no schema-valid object, the wrapper retries the same model in JSON object mode before falling back to the `structuredFallback` model (DeepSeek V4 Pro 0813). Retryable OpenRouter/provider failures such as 429s, 5xx responses, and structured no-object outputs can use the fallback model. Structured calls default to `maxOutputTokens=8000` so routine extraction and meeting-summary jobs keep quality headroom without over-reserving OpenRouter credits against unused completion tokens. Bulk callers may pass a higher per-call `maxOutputTokens` or batch their prompts. Authentication and request-shape failures still fail fast so misconfiguration is not hidden.

Agent chat streams also include an OpenRouter `models` fallback list so transient primary-model failures can route to `structuredFallback` before the UI or Telegram sees a failed answer. Chat logs and product analytics record both the requested model and the response model reported by the SDK, so server-side fallback routing is visible during incident review.

The catalog should mirror OpenRouter's advertised capabilities, not just model family names. The primary extraction, agent, summarization, and task-categorization routes use DeepSeek V4.1 Flash 1017 for long-context structured output, tools, and reasoning at a lower OpenRouter unit cost than DeepSeek V4 Pro 0813 or the previous Flash 0731 pin. DeepSeek V4 Pro 0813 remains the structured fallback when the primary route fails. The vision/OCR route uses Gemini 3.8 Flash because it advertises image, file, audio, and video input; sparse PDF page images and image uploads are sent as image or file parts, while dense text PDFs and office files extract inside Daytona sandboxes (anydoc) and do not call OpenRouter. Non-meeting voice-note transcription uses `openai/gpt-4o-transcribe` through OpenRouter's JSON audio endpoint. It is the current `retained_no_training_exception`: OpenRouter lists OpenAI as not training on prompts but retaining them, and OpenAI documents default API abuse-monitoring retention of up to 30 days. Do not call this route ZDR. It remains pinned until a broad-multilingual ZDR candidate passes the documented quality gate. OpenRouter lists a cheaper `:batch` sibling for the unpinned V4.1 Flash alias, not for the 1017 snapshot, so background re-extraction stays on the synchronous 1017 pin.

| Role                                                 | OpenRouter id                       | Context   | Tools / structured outputs                         | OpenRouter unit cost                                   |
|------------------------------------------------------|-------------------------------------|-----------|----------------------------------------------------|--------------------------------------------------------|
| extraction, agent, summarization, taskCategorization | `deepseek/deepseek-v4.1-flash-1017` | 1,048,576 | yes / yes (taskCategorization does not send tools) | \$0.15 / \$0.60 per 1M (weekday peak \$0.30 / \$1.20)  |
| structuredFallback                                   | `deepseek/deepseek-v4-pro-0813`     | 1,048,576 | yes / yes                                          | \$0.66 / \$1.98 per 1M (weekday peak \$1.32 / \$3.96)  |
| vision                                               | `google/gemini-3.8-flash`           | 1,048,576 | yes / yes                                          | \$0.825 / \$4.125 per 1M; image and audio match prompt |
| embedding                                            | `openai/text-embedding-3-small`     | 8,192     | n/a                                                | unchanged; switching invalidates the vector index      |
| transcription                                        | `openai/gpt-4o-transcribe`          | n/a       | n/a                                                | unchanged dedicated audio endpoint                     |

The embedding model remains special: changing it or its dimensions invalidates the current vector index. Embed jobs therefore do not model-fallback the way structured chat calls can; the shared `llm.embedMany()` helper retries direct callers, while the production worker disables SDK retries and lets BullMQ own outage backoff. Oversized provider requests split recursively inside the job; non-outage, non-client provider API batch failures get the same split fallback on the final queue attempt before the source is marked failed. Every vector is validated before Qdrant writes, preserving the pinned `openai/text-embedding-3-small` vector contract. Update the catalog and follow the re-embed procedure before switching traffic to the new collection.

The default Qdrant collection is `QDRANT_COLLECTION=events`. The app creates that collection on first embedding/search use with `TIMELINE_MODELS.embedding.embeddingDimensions`, `distance=Cosine`, original vectors and payload on disk, and scalar int8 quantization kept in RAM. Search rescores quantized hits against the original vectors. If an existing collection has a different vector size, the worker fails loudly instead of writing incompatible vectors; create a new collection and follow the re-embed procedure. Storage-layout changes (on-disk / quantization) copy existing points without re-embedding.

<span id="smoke-test"></span>

## 3. Quick smoke test

    curl https://openrouter.ai/api/v1/chat/completions \
      -H "Authorization: Bearer $OPENROUTER_API_KEY" \
      -H "Content-Type: application/json" \
      -H "X-OpenRouter-Cache: false" \
      -d '{"model":"deepseek/deepseek-v4.1-flash-1017","messages":[{"role":"user","content":"ping"}],"provider":{"data_collection":"deny","zdr":true}}'

This synthetic request exercises the same no-collection and ZDR routing preferences as Timeline's chat requests. A successful response proves that an eligible endpoint was available for this request; it does not prove the production key's guardrail assignment, account logging/sharing/cache settings, contract terms, or every other pinned model route.

The normal test suite mocks OpenRouter. To run only the optional live structured-extraction smoke test, export `OPENROUTER_API_KEY` and run `OPENROUTER_LIVE_TESTS=1 bun scripts/testing/run.ts packages/shared/src/llm/chat.test.ts --live`.

<span id="task-categories"></span>

## Task-category classifier

Canonical tasks are categorized asynchronously through the pinned `TIMELINE_MODELS.taskCategorization` model. Run the live 120-case release gate against the same environment with `TASK_CATEGORY_LIVE_ENV_FILE=/path/to/.env bun run test:task-category-eval:live`. The report includes exact accuracy, macro recall, prompt-injection safety, and a confusion matrix; it does not write task content to product analytics.

Historical work defaults to a dry run: `TIMELINE_ENV_FILE=/path/to/.env bun run --filter @timeline/worker task-category-backfill -- --team-id=<uuid> --limit=500`. Enqueueing requires both `--enqueue` and a projected-cost guard such as `--max-cost-usd=0.10`. The guard compares a fixed \$0.0002 per-task estimate (about 2× weekday-peak Flash 1017 spend on a 220/20 token packet), not actual provider spend; retries and provider pricing can differ. `--max-cost-usd` cannot exceed \$1, and each execution is limited to 5,000 tasks. Rerun it to resume. Already pending, manual, archived, and ready tasks are skipped.

Classification, automatic enqueue, the BullMQ worker, and the category UI default on. `TASK_CATEGORY_BACKFILL_ENABLED` stays off. Historical enqueue is a dry-run CLI until an operator passes `--enqueue` and `--max-cost-usd`. That cost flag cannot exceed \$1, the 5,000-task batch ceiling at the \$0.0002 estimate. `TASK_CATEGORY_DISABLED=true` is the emergency stop: it forces classification, enqueue, the worker, backfill, and the UI off together, even when those flags are set true. While classification is enabled, suggestion and agent task proposals stamp `task-categories-v1` before they are stored. A classifier response that omits a proposal, or that cannot be normalized, fails that suggestion job instead of saving an unstamped task. The other controls remain independent when the kill switch is off: `TASK_CATEGORY_AUTO_ENQUEUE_ENABLED`, `TASK_CATEGORY_WORKER_ENABLED`, `TASK_CATEGORY_BACKFILL_ENABLED`, and `TASK_CATEGORY_UI_ENABLED`. Disabling any control preserves stored categories and manual history. A disabled classification or worker control does not register the BullMQ consumer, so queued jobs remain available. Re-enable worker and enqueue controls together after an outage; the janitor repairs eligible pending rows and durable project fan-out cursors. A deployed environment that still sets a flag to `false` keeps that control off; the code default does not override an explicit value. The credential-thin document-extract service rejects `TASK_CATEGORY_*` variables, including the kill switch.

<span id="phase-3"></span>

## Verify transcription

`bun run canary:integrations` sends a tiny embedded spoken MP3 fixture through `llm.transcribeAudio()` and verifies the pinned OpenRouter transcription endpoint returns the expected canary words. This proves provider/model access and real speech decoding without requiring operator-recorded sample files.

The same canary also fetches OpenRouter's public [`/api/v1/endpoints/zdr`](https://openrouter.ai/api/v1/endpoints/zdr) registry without an API key and checks every unique model classified `zdr_required`. It warns when a required pin has no listed ZDR endpoint or the registry response cannot be validated. With the one shared inference key, it also issues a tiny authenticated synthetic request through every unique required model surface: structured DeepSeek Flash and Pro, Gemini vision with an embedded synthetic pixel, and OpenAI embeddings. Those requests always use OpenRouter's official API origin, require `data_collection: deny` and `zdr: true`, and explicitly disable response caching. The report keeps only the exact model, covered role, status, and latency; it never records prompt, image, embedding, or response content. This is a defense-in-depth drift signal, not a replacement for the exact key allowlist, account controls, or keeping `OPENROUTER_PRIVACY_POLICY_ATTESTATION` truthful. The retained transcription exception has its own quality and availability probe but is intentionally excluded from the ZDR request set.

Do not change `TIMELINE_MODELS.transcription` from the current quality exception on the strength of a registry entry or a single-language smoke test. Build an approved, non-customer corpus that satisfies [the multilingual transcription evaluation contract](../testing/transcription-quality-eval.md), then run the aggregate-only live gate:

    TRANSCRIPTION_QUALITY_EVAL_ENV_FILE=/secure/eval.env \
    bun run eval:transcription-quality:live -- \
      --manifest=/secure/corpus/manifest.json \
      --out=/secure/evidence/transcription-eval.json \
      --baseline=openai/gpt-4o-transcribe \
      --candidate=<current-zdr-model-id> \
      --require-passing-candidate

The output is an immutable aggregate evidence artifact: it contains quality, error, latency, availability, route, and cost metrics, never audio or transcript content. Keep the production pin unchanged when no candidate passes every gate.

After setting `OPENROUTER_API_KEY` and starting `bun run dev`:

1.  Record a ~5s voice memo via the web recorder on `/app`. Optionally type a note in the same capture before posting.
2.  The row appears immediately with an audio player, the typed note if provided, and a "Transcribing…" placeholder. The BullMQ `transcribe` worker pulls the bytes from RustFS, posts JSON/base64 audio to `${OPENROUTER_BASE_URL}/audio/transcriptions` with the pinned transcription model from `TIMELINE_MODELS`, and writes the transcript back onto `content_text` alongside the note.
3.  Refresh — the transcript appears.

Without the key set, voice notes still record and play back; the transcribe job retries until the key is available (BullMQ default exponential backoff, 3 attempts).

<span id="phase-4"></span>

## Verify extraction + object links

After `OPENROUTER_API_KEY` and `REDIS_URL` are set, with `bun run dev` (web) and the worker process running:

1.  Post a text note on `/app` such as `Met with John Ternus at Apple about SaaS licensing.`
2.  Within a few seconds the extract worker should write a row into the `facts` table. It links mentions only to existing workspace objects; it does not create new objects from a first mention.
3.  Visit `/app/approvals` for any object-memory proposal the suggestion worker can support with durable evidence. Weak link targets or app mentions should stay raw evidence rather than becoming objects.
4.  If the fact references an existing object, click into that object to see the aggregated source events, confidence-scored fact statements, and any `Fact (N)` disclosures linking to other objects attached to the same fact.

Without `OPENROUTER_API_KEY`, the text and voice notes still land on the timeline. The extract worker fails (no key), and after retries are exhausted the raw event row gets `source_metadata.extraction_failed_at` / `extraction_error` set. Provide the key and run the re-extraction script below to backfill.

<span id="entity-resolution-scope"></span>

### Entity resolution scope

Resolution is deterministic name + alias matching within a team. Extraction links to an existing object when it can, but unmatched mentions remain unlinked evidence until an approval-backed object-memory proposal creates or updates a workspace object. Two limitations to know about:

- **No fuzzy / embedding-based dedup.** "Apple" and "Apple Inc" land as two rows unless one already lists the other as an alias. Use select mode on `/app/objects` and the merge preview at `/app/objects/merge` to fold one into the other; aliases combine and derived object references move atomically.
- **Same name, different team = different entity.** Entity rows are team-scoped by design. Cross-team resolution is intentionally out of scope.

Cleanup suggestions add conservative name/alias-based merge and archive proposals, but merge suggestions still route through the manual preview before any state changes are applied. The preview shows per-candidate related facts for identity checks and lets reviewers reject the suggestion without leaving the dialog.

<span id="reextraction-procedure"></span>



## Verify embeddings + semantic search

After `OPENROUTER_API_KEY`, `REDIS_URL`, and `QDRANT_URL` are set, with the docker stack (`docker compose up -d`) running and both `bun run dev` (web) and the worker process started:

1.  Let the first embedding/search write create the default `events` collection, or create it explicitly with the current catalog dimensions if you prefer a manual setup check. Current default: `openai/text-embedding-3-small`, `vectors.size=1536`, `distance=Cosine`, `on_disk=true`, scalar int8 quantization.

        curl -s "$QDRANT_URL/collections/events" \
          -H "api-key: $QDRANT_API_KEY" | jq '.result.config.params.vectors.size'

    A missing collection before the first write is fine. Any existing value other than `1536` means the collection belongs to an older embedding model and must not be reused. Each worker batch embeds up to 16 chunks with one OpenRouter embeddings request; request-size failures split the batch recursively, while transient provider outages retry from the `embed` queue with six exponential-backoff attempts. On the final attempt, non-outage provider API batch failures that are not client/auth errors also split recursively before the source row is stamped with `embedding_failed_at` and picked up by the coverage audit/re-embed flow.

2.  If creating the collection through the Qdrant dashboard, use:

    - **Name**: `events` or the new cutover name.
    - **Use case**: Multitenancy.
    - **Tenant field name**: `team_id`.
    - **Vector type**: Dense vector.
    - **Vector name**: leave unnamed/default; the app writes bare vectors.
    - **Vector size**: `1536`.
    - **Distance**: Cosine.
    - **Quantization**: Scalar, int8, quantile `0.99`, always in RAM.
    - **On-disk vectors**: enabled (original float32 vectors stay on disk).
    - **On-disk payload**: enabled.

    The equivalent API shape is:

        curl -s -X PUT "$QDRANT_URL/collections/events" \
          -H "content-type: application/json" \
          -H "api-key: $QDRANT_API_KEY" \
          -d '{"vectors":{"size":1536,"distance":"Cosine","on_disk":true},"quantization_config":{"scalar":{"type":"int8","quantile":0.99,"always_ram":true}},"on_disk_payload":true}'

        curl -s -X PUT "$QDRANT_URL/collections/events/index" \
          -H "content-type: application/json" \
          -H "api-key: $QDRANT_API_KEY" \
          -d '{"field_name":"team_id","field_schema":{"type":"keyword","on_disk":false,"is_tenant":true}}'

3.  Post 2–3 text notes on `/app`, e.g. `Met with John Ternus at Apple about SaaS licensing.` and `Caught up with Apple folks on the agreement structure.`

4.  The extract worker writes facts; the embed worker writes one or more Qdrant chunk points per fact and raw event, depending on source text length. Oversized sources continue through bounded child jobs, so the worker does not drop tail text or monopolize one job. Confirm via:

        curl -s "$QDRANT_URL/collections/events" | jq '.result.points_count'

5.  Use global search on `/app/search` and query `licensing discussion with Apple`. The events above rank in the top results even though one does not contain the word "licensing".

6.  Mark a note as `private` in the capture form before posting. The embed worker stamps `embedding_skipped_reason=visibility=private` on `source_metadata` and writes nothing to Qdrant. Teammates running the same query do not see the private row in their search results — the Qdrant wrapper's filter and `withTeam`'s second-line check both drop it.

Without `OPENROUTER_API_KEY` or `QDRANT_URL`, semantic timeline search returns an unavailable warning in global search. Notes still capture; embeddings are deferred until config + reembed.

<span id="phase-6"></span>

## Verify agent chat

`/app/chat` provides streaming agent answers over indexed evidence. Every claim cites the raw event via inline `[ev:<uuid>]` chips. The chat endpoint requires both `OPENROUTER_API_KEY` (for the model) and `QDRANT_URL` (the agent's `search_timeline` tool); without either, `/api/chat` returns 503 `chat_unconfigured` and the UI surfaces a real error instead of looping the agent against a broken backend.

Chat context is compressed before model calls when the estimated prompt reaches 80% of the agent model context window. Background LLM jobs use the same catalog-backed budget policy to trim extraction, suggestion, and meeting-finalize prompts before calling OpenRouter. The thresholds live beside the model catalog in `DEFAULT_CHAT_MEMORY` and `DEFAULT_LLM_CONTEXT`.

After embedding verification works end-to-end (events embedded, search bar returns hits), open `/app/chat` and run the three brief queries:

1.  **"What did the team work on yesterday?"** — exercises `list_events` with a date filter. Expect a bulleted list where every bullet ends with `[ev:<uuid>]`. Clicking a chip jumps to that event in the timeline via `#ev-<uuid>` anchor.
2.  **"What was discussed with John Ternus last time?"** — exercises `get_entity` + `search_timeline`. The chat pane shows two visible tool-step chips ("Looked up entity 'John Ternus'", "Searched timeline for …") above the assistant's reply.
3.  **"What's outstanding for Acme?"** — the agent infers from event content; every inference still carries a citation.

Adversarial checks worth running once:

- Paste a UUID known to belong to another team. The agent calls `get_event`, the tool returns `{ found: false }`, and the assistant says "I don't have an event with that id" — never the cross-team row.
- Ask about a team that isn't yours. The agent answers from your active team only; switching teams via the team switcher swaps the agent's context.

The agent is capped at 20 tool turns per turn. Tool errors are caught inside `execute` and returned as `{ error: 'tool_failed' }` so the stream stays alive — the agent recovers or reports failure with a citation-aware message rather than crashing the response.

<span id="reembed"></span>






## Maintenance

Follow [reindex and collection migration](../runbooks/reindex.md) for re-extraction, embeddings, writer freezes, backups and rollback. Setup is not authorization to operate on production.
