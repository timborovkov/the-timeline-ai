# Integrations setup

Provider accounts are person-owned. Members share selected sources with a team; admins activate team capture. Live custom MCP tools and hosted Timeline MCP are separate from native source sync.

| Task | Guide |
| --- | --- |
| Google sign-in | [Google sign-in](google-sign-in.md) |
| Google Drive | [Google Drive](google-drive.md) |
| Linear | [Linear](linear.md) |
| GitHub | [GitHub](github.md) |
| Monday.com | [Monday.com](monday.md) |
| Slack workspace ingestion | [Slack workspace ingestion](slack-source.md) |
| Sentry native source | [Sentry native source](sentry-source.md) |
| Ingest webhooks | [Ingest webhooks](ingest-webhooks.md) |
| Custom MCP servers (inbound) | [Custom MCP servers (inbound)](custom-mcp.md) |
| Timeline as an MCP server (outbound) | [Timeline as an MCP server (outbound)](timeline-mcp.md) |

## Encryption key (required first)

All integration auth (OAuth refresh + access tokens, bearer tokens, custom-header values, basic-auth credentials, MCP dynamic-client secrets) is encrypted at rest with AES-256-GCM in `packages/shared/src/crypto/secrets.ts`. Generate a 32-byte key and set `SECRETS_ENCRYPTION_KEY` in your environment:

    bun --no-env-file -e "console.log(require('crypto').randomBytes(32).toString('base64'))"

The first `encryptSecret()` call throws with a clear message if the key is missing or the wrong length, so worker boot fails fast instead of writing plaintext.

<span id="native-ui-model"></span>

## Native integration UI model

Native integrations have three separate layers. **Provider account** is the OAuth grant owned by the member who connected it. **Shared sources** are the boards, repositories, projects, drives, or channels that owner allows the current Timeline team to use. **Team sync** is the admin-selected import path that turns shared sources into timeline evidence.

A member can connect more than one provider account when the provider returns a different external account id. For providers that reuse the currently signed-in account, such as Monday.com in many browsers, start *Connect account* again and choose another account in the provider's OAuth account picker, or sign out/switch accounts in the provider before approving Timeline.

Disconnecting an active import stops that team's sync path. Deleting a provider account removes the member-owned OAuth grant and leaves affected teams with connection attention so an admin can reconnect, replace the source path, or pause the import intentionally.

<span id="connection-health"></span>

## Connection health and auto-pause

Native team sync (GitHub, Linear, Google Drive, Monday.com, Slack, and Sentry) tracks consecutive connectivity, auth, access-revoked, and permanent provider errors on the team integration. Rate limits and 5xx do not count and do not reset the clock. After `INTEGRATION_HEALTH_PAUSE_AFTER_HOURS` (default 72, minimum 1) of sustained counted failure, Timeline pauses that integration: scheduled ticks stop, the row shows a short Paused notice, and one owner is notified once. Access-revoked and auth pauses offer Reconnect; connectivity and permanent pauses offer Resume. Reconnecting the provider account or Resume clears the health clock. Resume also queues a backfill, and a retry re-queues that backfill if the pause was already cleared. Slack auth errors such as `token_revoked`, `invalid_auth`, and `account_inactive` count as access-revoked. Telegram capture, Slack capture, Recall meeting bots, and custom MCP servers are not on this scheduled sync path.

<span id="google-sign-in"></span>























## How sync runs

A BullMQ repeatable enqueues an `integration-sync` tick every 5 minutes. The worker fans out to enabled native team scopes that are due and runs `incrementalSync()` through the owning provider connection, using the per-resource cursor in `integration_sync_state`. Providers with inbound webhooks persist native deliveries first, then the `webhook-delivery` worker normalizes the matching team targets and enqueues either targeted sync work or a bounded catch-up fallback. A successfully written Monday update/reply deletion is explicitly terminal for that delivery and does not enqueue a broad catch-up; genuinely unhandled deliveries retain the fallback. Google Drive push deliveries enqueue a targeted `drive.changes` job through that same worker, then delayed per-file `drive.file` jobs; they do not fall back to a broad catch-up incremental. GitHub, Linear, Monday.com, Slack, and Sentry also route protected deliveries through the shared delivery worker. GitHub repo deliveries, Monday item/board deliveries, and Sentry project deliveries hydrate only the affected selected resource. Sentry issue alert, issue lifecycle, and release payloads can also write direct events before the reconciliation pass. Provider rate-limit responses also create account/app budget pauses in `integration_provider_budgets`; the scheduler skips every matching integration until the provider retry time rather than retrying per Timeline team. GitHub selected repos and organization scopes can accept signed webhook deliveries, while slow reconciliation still covers missed events and backfill. GitHub background sync skips active provider rate-limit pauses, waits 24 hours after the previous successful sync, and caches organization repo expansion for a short window so org-wide selections do not re-list every repository on every tick. GitHub repo cursors are also split by surface — PRs, issues, issue comments, inline PR review comments, commits, releases, and workflow runs — so one failing or noisy surface does not block cursor advancement for the others. Daily reconciliation retains independent checkpoints for releases, workflow runs, and other surfaces. MCP servers are monitored by the MCP health worker, but that health check only validates connectivity and cached tools.

Routine recovery is daily for all six native providers. Webhooks remain the prompt update path; quota pauses can delay recovery beyond 24 hours. Drive renews change-notification watches and retains its change token. Linear checkpoints collection pages with timestamp overlap. Sentry checkpoints issue and release pages and stops release enumeration at the saved boundary. Explicit backfill and resync use the same limits. Monday retains its 100-call UTC daily cap; other providers use measured usage and provider-reported cooldowns rather than a new universal cap.

With Redis configured, the shared request guard coordinates concurrent requests and cooldowns across workers and web processes. Logs contain provider, request purpose, operation, hashed quota identity, outcome/status, duration, and numeric remaining capacity, never tokens or content. Timeline request counters are separate from the provider's remaining capacity, which other apps can consume. Slack and Telegram final answers and command responses respect rate-limit retry times through durable delivery; queued Telegram edits coalesce to the latest version, and final sends remain distinct; an ambiguous send timeout is not automatically replayed.

Operators can roll out providers independently with comma-separated `INTEGRATION_REQUEST_GOVERNOR_PROVIDERS` and `INTEGRATION_RECOVERY_PROVIDERS`. Both default to all six native providers; an empty list disables that layer. Disabling recovery preserves cursors and never restores legacy Slack polling. Monday's existing daily cap remains active independently. Compare request counts, quota pauses, pending work, and last successful sync before and after each rollout.

GitHub commit sync keeps a high-water SHA per repo. If a repo has more than the configured page window of new commits, the worker saves a commit-gap checkpoint and the next incremental run continues draining older commits instead of replaying the same page window forever. A first sync that starts with oversized commit history imports the newest window, records an audit row, and advances the high-water cursor so future polling stays current. Timestamped issue-comment and inline-review-comment syncs use a per-surface continuation: whenever a scan spans more than one mutable results page, Timeline treats that traversal as provisional and replays the result set from page one until two full page traversals agree before it advances the timestamp cursor. The worker resumes ordinary page handoffs promptly, backs off a changing dense boundary for a bounded number of replay attempts, and preserves its checkpoint for later reconciliation. Rate-limited comment checkpoints resume as targeted work for that same comment surface when the provider's recorded retry time arrives, so an issue-comment retry cannot consume an inline-review checkpoint. Each cursor checkpoint and its continuation handoffs commit together to durable recovery storage before the sync reports success.

Manual full backfill from the CLI:

    bun run --filter @timeline/worker integration-resync -- --team=<uuid> --from-zero

Existing Monday connections that selected hidden helper boards can be repaired with the team-scoped command below. It is a dry-run unless `--apply` is present. The command reports identifiers and counts only, preserves historical raw events, removes invalid shares/selections/cursors/subscriptions, deprovisions any recorded provider-side helper-board webhooks before deleting their local state, and queues parent-board backfills after apply. Discovery covers both current provider-connection shares and direct legacy Monday integration selections, including orphan board cursors and webhook rows left after a selection was removed. Each successful provider webhook deletion is recorded immediately, making a partially failed cleanup safe to rerun without deleting the same remote webhook twice. Backfill and webhook-reconciliation follow-ups are also persisted independently; rerun the same apply command to retry a failed step while skipping any step already completed. Use the provider-connection owner's user UUID; that user must also be a team admin so the command can verify each stored board through monday before changing it. Direct integrations use their integration token. Boards omitted from an otherwise successful monday classification response are listed as missing under their credential source and treated as unverified. An apply refuses any unverified credential sources unless the operator explicitly adds `--allow-unverified` after reviewing the dry-run.

    bun run repair:monday -- --env-file=/path/to/.env \
      --team-id=<team-uuid> --user-id=<admin-user-uuid>

    bun run repair:monday -- --env-file=/path/to/.env \
      --team-id=<team-uuid> --user-id=<admin-user-uuid> --apply

<span id="audit"></span>

## Audit log

Every connect, sync start, sync finish, sync error, and replay writes a row in `integration_audit_log`. `/app/team/integrations/audit` renders the most recent 200 integration audit rows. Provider resource sharing and activation also write generic `audit_log` settings rows for team-level audit exports. The agent's `list_integrations` tool also surfaces connected providers + their `last_synced_at`.

<span id="troubleshooting"></span>

## Troubleshooting

### Need to verify live provider credentials without leaking secrets
Run `bun run canary:integrations -- --env-file=/path/to/.env`. The canary prints only `OK`, `WARN`, or `SKIP` rows for OpenRouter, GitHub App auth, Sentry API access, Resend API access, native OAuth authorize endpoints, and native webhook/signing secrets, followed by secret-safe next steps for any non-OK row. Use `bun run canary:integrations:strict -- --env-file=/path/to/.env` when every row must be `OK`. Configured GitHub, Google Drive, Linear, Monday.com, Slack, and Sentry OAuth rows require both client id and client secret env vars to be present, then build the provider authorize URL and make a secret-free request to the provider, treating provider-side non-5xx responses as proof that the app registration is reachable. The Sentry API row uses `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, and `SENTRY_PROJECT` and expects the token to have project read access; the Sentry webhook-signature row uses `SENTRY_INTEGRATION_CLIENT_SECRET`. The Resend API row uses `RESEND_API_KEY` for a read-only received-email lookup; the inbound webhook row checks `RESEND_WEBHOOK_SECRET`. An optional `RESEND_INBOUND_CANARY_EMAIL_ID` identifies an existing synthetic received email. With `RESEND_INBOUND_CANARY_ALLOWED_ORIGIN` matching the app origin, the canary sends a signed replay to `/api/email/inbound` and verifies a captured event. It may find an existing event and does not prove new SMTP delivery.

### Need to exercise the Monday board contract against a dedicated canary board
Set `MONDAY_CANARY_ACCESS_TOKEN` and `MONDAY_CANARY_BOARD_ID`, then run the normal integration canary command. The read-only check verifies that the target is a real board and that all-depth item discovery is accepted. To also create and immediately delete a webhook, set `MONDAY_CANARY_PROVISION_WEBHOOK=1`; this additionally requires `AUTH_URL` and `MONDAY_WEBHOOK_SECRET`. Never point the canary at a production customer board or a classic helper board.

### Webhook returns `bad_signature`
Check the secret env var matches what the provider's webhook UI shows. The signing algorithm is HMAC-SHA256 over the raw body — make sure the provider hasn't re-serialised the JSON in transit.

### Connect button stays disabled
The provider's OAuth client env pair is missing or empty. Set both `CLIENT_ID` and `CLIENT_SECRET` and restart.

### Sync runs but no timeline events
The agent's dedup_key partial unique index makes replay a no-op. Use `--from-zero` on the resync script to wipe the cursor and re-walk from provider epoch.
