# Re-extraction, embedding and vector maintenance

Use a maintenance window and scoped evidence. Never use customer data for development fixtures. Setup belongs in [OpenRouter](../setup/openrouter.md).

## Re-extraction procedure (when changing the extraction prompt or model)

The `model_version` written on each fact combines the model id that actually produced the structured result with an internal code-revision tag. Under normal conditions this is the extraction model from `TIMELINE_MODELS`; if the structured fallback route handled a retryable provider failure, audits record that fallback model instead. When the primary extraction model or prompt changes, replay raw events:

Re-extraction treats both the primary extraction route and the configured `structuredFallback` route as current for the same code-revision tag. That keeps transient fallback successes from being reprocessed into duplicate visible facts during routine coverage sweeps.

1.  Update `packages/shared/src/llm/models.ts` if the model changes.

2.  Run for one team:

        bun run --filter @timeline/worker reextract -- --team=<teamId>

3.  The script walks every raw event for the team, skips rows that already have facts at the current `model_version`, and enqueues an `extract` job for the rest. The worker is independently idempotent — re-running the script is safe.

This is intentionally **manual**: extraction is the first place we burn tokens at scale, and silent auto-replay would surprise the bill.

<span id="phase-5"></span>

## Re-embed procedure (when changing the catalog embedding model or dimensions)

The embedding model is pinned. Changing it invalidates every vector in the existing collection — semantic search would silently degrade as old and new embeddings drift apart in vector space. The cutover below keeps the old collection alive (read-only) while the new one is populated, then flips reads atomically via the `QDRANT_COLLECTION` env var.

Use this same procedure if production reports a vector-size mismatch, for example an existing `events` collection at `2560` while the current catalog expects `1536`. Do not delete the old collection before the replacement has been populated and verified.

1.  **Update the model catalog** in `packages/shared/src/llm/models.ts`. Leave `QDRANT_COLLECTION=events` unchanged until cutover if the current collection still accepts writes. If the current collection already has the wrong vector size, failed jobs can wait while you create and populate the replacement collection.

2.  **Create the new collection** with the new vector size. This step is **mandatory** — the embed worker uses `requireExisting=true` when a `targetCollection` is on the job, so a stale worker process started before the catalog change cannot silently auto-create the new collection at the old dimension and corrupt the cutover. The worker errors loudly if the collection is missing.

        curl -s -X PUT "$QDRANT_URL/collections/events_v2" \
          -H "content-type: application/json" \
          -H "api-key: $QDRANT_API_KEY" \
          -d '{"vectors":{"size":1536,"distance":"Cosine","on_disk":true},"quantization_config":{"scalar":{"type":"int8","quantile":0.99,"always_ram":true}},"on_disk_payload":true}'

3.  **Re-embed each team** into the new collection. The worker reads `targetCollection` from the job payload and writes there instead of `QDRANT_COLLECTION`. The old collection is untouched.

        bun run --filter @timeline/worker reembed -- \
          --team=<teamId> \
          --target-collection=events_v2

    Re-running is idempotent — point ids derived from `(scope, sourceId, embedding_model, chunk_index)` are deterministic, so the same source chunk maps to the same point id and Qdrant upserts naturally. Upserts use Qdrant's synchronous `wait=true` mode, so worker completion metadata is written only after the vector change is applied. After the final chunk batch lands, the worker deletes stale tail points for the same `(team, scope, source, model)` where `chunk_index` is beyond the new chunk count, so shorter re-embeds do not leave obsolete tail chunks.

4.  **Verify** spot-checks against the new collection by overriding `QDRANT_COLLECTION` in a single shell before flipping production:

        QDRANT_COLLECTION=events_v2 bun run --filter @timeline/web dev

5.  **Cut over** by setting `QDRANT_COLLECTION=events_v2` everywhere and restarting web + workers. The flip is atomic from the reader's perspective — the next request hits the new collection.

6.  **Drop the old collection** after a grace period (a day is plenty; rollback is just flipping `QDRANT_COLLECTION` back):

        curl -s -X DELETE "$QDRANT_URL/collections/events" \
          -H "api-key: $QDRANT_API_KEY"

This procedure is the **only** safe path. Never edit embeddings in place — embedding-model drift silently corrupts semantic search, and "looks ok in prod" is not a reliable signal until queries start ranking the wrong things.

The shared Qdrant client handles transient cold-start failures with bounded read retries and caller cancellation. Interactive retrieval has a 30-second Qdrant budget; writes are not blindly replayed after ambiguous failures. For optional Railway sleeping, deployment order, telemetry configuration, and rollback checks, follow the [Qdrant Serverless runbook](../railway.md#qdrant-serverless).

<span id="qdrant-storage"></span>

## On-disk collection copy (no re-embed)

Changing Qdrant storage layout — on-disk original vectors, scalar int8 quantization in RAM, on-disk payload — does **not** change embedding dimensions. Do not re-embed. Create a new collection, pause embed writers, copy every point with scroll + upsert (plus a second resync pass), verify counts and point identity, then switch `QDRANT_COLLECTION`. Existing collections are never patched in place. An existing target must already have the on-disk + quantization layout; a leftover in-RAM collection with the same name is rejected. By default the script refuses production. An isolated staging cluster requires `ALLOW_QDRANT_MIGRATE_REMOTE=I_UNDERSTAND_THIS_TARGETS_AN_ISOLATED_QDRANT`. Production uses the separate maintenance procedure below.

1.  **Create the target collection** with the current app create body (same `requireExisting` contract as re-embed). The migrate script can do this:

        bun run --filter @timeline/worker qdrant-migrate-collection -- \
          --source-collection=events \
          --target-collection=events_ondisk \
          --create-target --copy --verify --writers-paused --all-teams

    Pause the embed worker (and any other Qdrant writers) first. Live `--copy` requires `--writers-paused` and always runs a second resync pass so inserts during the first scroll are not lost. Copy and verify always filter by `team_id`. `--all-teams` copies tenants discovered on the source; verify unions source and target tenants so leftover target-only points fail identity. Or PUT the collection yourself, then run with `--copy --verify --writers-paused --all-teams` only. The copy client uses `requireExisting=true` on the target, so a missing collection fails loudly instead of auto-creating at the wrong size.

2.  **Verify counts and identity**. The command exits non-zero when source and target point counts differ, or when ids / vector fingerprints / canonical full payloads disagree (including `visibility_user_ids` and author/owner fields). Count equality alone cannot catch an in-place vector overwrite. Re-running the copy is idempotent — point ids are preserved.

3.  Optional **RAM / recall probe** against the demo corpus (Acme Labs owner). Live `--measure` waits until HNSW/quantization is indexed on both collections (Qdrant 1.20.0: `indexing_threshold=1` KB, because `0` disables indexing, and `full_scan_threshold=10`, the minimum Qdrant accepts), *then* snapshots RAM from `GET /collections/{name}/memory`, then compares recall. `--dry-run --measure` does not PATCH optimizer thresholds and does not require the target to exist. Samples are filtered to the requested team, the query point is excluded from both rankings, and the uncompressed baseline is exact search with `quantization.ignore`. Zero comparable queries are reported as `no_data` (exit 1), not 100% recall:

        bun run --filter @timeline/worker qdrant-migrate-collection -- \
          --source-collection=events \
          --target-collection=events_ondisk \
          --measure --team=20000000-0000-4000-8000-000000000001 \
          --user=10000000-0000-4000-8000-000000000001

    The probe persists those optimizer settings on both source and target collections. Before resuming normal searches, restore `full_scan_threshold` on both to its previous value (the Qdrant default is `10000` KB). The forced `10` KB threshold can reduce recall for small filtered result sets, including the demo's fact checks. Keep the chosen `indexing_threshold` if this small corpus should remain indexed and quantized. Verify the target explicitly before the environment cutover in the next step:

        (
          set -e
          for collection in events events_ondisk; do
            curl --fail --request PATCH "$QDRANT_URL/collections/$collection" \
              --header "api-key: $QDRANT_API_KEY" \
              --header "Content-Type: application/json" \
              --data '{"hnsw_config":{"full_scan_threshold":10000}}'
          done
          QDRANT_COLLECTION=events_ondisk bun run demo:verify
        )

4.  **Cut over** by setting `QDRANT_COLLECTION=events_ondisk` on web and workers, then restart. During maintenance, rollback is switching the name back. After writers resume, reconcile newer writes before rolling back. Retain the old collection through the rollback grace period, same as re-embed.

Binary quantization is opt-in (`QDRANT_QUANTIZATION=binary`) and uses a higher default search oversampling (4 vs 2). Keep scalar int8 unless you have measured recall on your corpus. The optimizer-changing `--measure` probe is forbidden in production.

<span id="qdrant-production-copy"></span>

### Production maintenance

1.  Schedule a maintenance window and stop every Qdrant writer, including web processes that delete vectors and workers that embed them. Keep queues intact. Set `QDRANT__STORAGE__SNAPSHOTS_PATH=/qdrant/storage/snapshots` on the Qdrant service and restart it before proceeding so backups live on its persistent volume.

2.  In the operator process, use the real production environment, URL, API key, and active `QDRANT_COLLECTION`. Keep the acknowledgment out of service variables:

        ALLOW_QDRANT_MIGRATE_PRODUCTION=I_UNDERSTAND_THIS_MIGRATES_PRODUCTION_QDRANT \
        bun run --filter @timeline/worker qdrant-migrate-collection -- \
          --production --source-collection=events --target-collection=events_ondisk \
          --create-target --copy --verify --writers-paused --all-teams

    Production requires every flag shown, except `--create-target` when the destination already exists. `--dry-run` previews without a snapshot or writes. A live run must complete a nonempty source snapshot before writing the destination. The source must match the active collection. Verification checks per-team counts, IDs, vectors, full payloads, and collection-wide totals to catch unassigned points. Stop on any nonzero exit; retain both collections and inspect the report. Before cutover, compare representative searches under the same team and visibility filters. If recall is lower, tune the destination HNSW configuration and repeat the comparison. Raising `ef_construct` rebuilds its index and increases its default search breadth. Keep source optimizer settings unchanged.

3.  After successful verification, set `QDRANT_COLLECTION=events_ondisk` on web and the full worker service, redeploy them, and check their health and team-scoped retrieval. The credential-thin document extractor does not access Qdrant and must not receive its keys. Keep the original collection and snapshot. Before any later rollback, pause writers and reconcile writes made after cutover; simply switching back would omit those writes.
