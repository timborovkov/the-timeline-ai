# Meeting bot setup

Paste a Google Meet, Microsoft Teams, or Zoom link into `/app/meetings`, save a reusable meeting link, or use a Slack/Telegram join command. A silent **Recall.ai** bot joins, uses Recall's streaming transcription with automatic language detection, and the meeting appears as a single event on the timeline with summary, speakers, and action items.

Meetings are a first-class capture source. The bot joins silently (it appears as a participant but does not speak or stream video). Each finalised utterance is written as a `meeting_transcript_chunks` row for the meeting detail UI and utterance-level search. When the call ends, the finalize worker creates one consolidated `raw_events` row with the full transcript so the meeting appears as a single timeline entry, then creates a native calendar event for the call with links back to the meeting detail page. When OpenRouter summary generation succeeds, the row also carries the LLM-generated summary and action items. Retryable provider/API failures keep the finalization job retryable; non-retryable structured-output failures still finalize the transcript and record the summary error in metadata for operations debugging. The linked calendar audit rows stay factual and extraction-skipped, so generated meeting notes do not feed a second extraction pass.

Completed meeting detail pages expose the transcript directly, with controls to download a Markdown copy or open the browser print flow for PDF export.

<span id="saved-meetings"></span>

## Saved Meetings and quick joins

**Saved Meetings** are team-owned reusable Meet/Teams/Zoom links with aliases, optional schedules, default visibility, and a one-time permission confirmation at creation. Later joins do not ask for per-call approval. Scheduled Saved Meetings materialize future calendar entries, and each actual capture is linked back to the saved configuration and enriched after finalization.

Existing Saved Meetings can be edited, including their meeting URL. Changing the URL can also change the provider; Timeline cancels and regenerates future scheduled captures and generated calendar entries with the new link while leaving past or active captures intact. Aliases are unique among active Saved Meetings in a team and become available again when a Saved Meeting is archived.

The scheduler worker scans for due Saved Meeting occurrences and starts the bot at the saved meeting's configured join offset, defaulting to two minutes before the scheduled start. If nobody admits or joins the bot, Google Meet captures use a 550-second no-show timeout; while the configured call window remains open, the first timeout is requeued once immediately. A second no-show is terminal. If the retry cannot start before that window closes, Timeline also terminalizes it instead of leaving it scheduled. Late lifecycle events from the first bot are ignored, and recurring auto-join pauses after three terminal no-shows or provider failures. Manual joins can still be triggered from the dashboard or commands.

Slack supports `/timeline join <alias-or-url> [title]`. Telegram supports `/join <alias-or-url> [title]`. Saved Meeting aliases join immediately. Raw URL quick joins always require prompt-specific confirmation first, either with the button or a direct affirmative Telegram reply to the pending prompt. Passive conversation never starts a bot.

<span id="provider"></span>

## Why Recall.ai (and what else works)

Recall.ai is the default provider — handles all three platforms (Meet / Teams / Zoom) with one API, ships a hosted bot fleet so we don't run audio infrastructure. Per-minute pricing applies; check current rates at [recall.ai](https://recall.ai).

The provider lives behind a `MeetingBotProvider` interface (`packages/shared/src/meeting-bots/`). Swapping to one of the alternatives below is a single-file change — webhook routes, scope helpers, and the worker all stay the same.

- **Attendee.dev** — self-hosted, cheaper per minute, more ops overhead. Use if Recall.ai cost becomes the bottleneck.
- **Meeting BaaS** — similar to Recall, alternative pricing.
- **Native APIs** (Google Meet Media API, Teams Real-Time Media) — lowest cost but each platform is a separate integration.

<span id="account"></span>

## 1. Account + API key

1.  Sign up at [recall.ai](https://recall.ai).
2.  Create an API key from the Recall dashboard.
3.  Copy the **Region URL** (default `us-west-2`).

<!-- -->

    RECALL_API_KEY=...
    RECALL_BASE_URL=https://us-west-2.recall.ai/api/v1
    TIMELINE_DEPLOYMENT_MODE=hosted
    RECALL_RETENTION=

Recall currently documents four data-isolated API regions: `us-west-2.recall.ai`, `us-east-1.recall.ai`, `eu-central-1.recall.ai`, and `ap-northeast-1.recall.ai`. Hosted production accepts only HTTPS `/api/v1` endpoints on those hosts. Development and explicitly self-managed production may use an operator-owned alternative endpoint.

`RECALL_RETENTION` defaults to **1 hour** when unset or empty. The bot request sends `recording_config.retention = { type: "timed", hours: 1 }`, which keeps Recall recording media only briefly after the meeting completes. Production with `TIMELINE_DEPLOYMENT_MODE=hosted` accepts only unset/empty or `1`; the mode defaults to `hosted` so this fails closed. Development or a separately licensed and operated production deployment may explicitly select `self-managed` and set a positive integer for longer timed storage or `forever`. That operator owns the resulting retention policy and notices. Zero retention values are rejected.

Timeline always uses Recall's accuracy-prioritised multilingual transcription path with auto language detection. Recall's zero-retention mode is intentionally not exposed because it is incompatible with `prioritize_accuracy` and would downgrade mixed-language meetings to the low-latency English path.

The one-hour request setting does not make Recall a zero-retention service. [Recall documents that operational logs remain for 7 days and that the meeting URL is removed 14 days after the bot terminates](https://docs.recall.ai/docs/storage-and-playback). Record the production region, DPA/subprocessor snapshot, account-level defaults, and a sample bot request showing the intended one-hour retention before relying on this configuration in customer-facing claims.

<span id="live-canary"></span>

## 2. Live canary

`bun run canary:integrations` checks `RECALL_API_KEY` and `RECALL_BASE_URL` with a read-only future bot list probe. It calls Recall's `GET /bot/` endpoint with a one-row limit and does not create, schedule, join, or delete any bot. A green row proves the configured key, region URL, and workspace access are usable before operators trust scheduled meeting capture.

<span id="webhooks"></span>

## 3. Webhook endpoints

Recall signs both dashboard status webhooks and per-bot realtime transcript webhooks. Create a workspace verification secret in the same Recall region as the API key, then copy the exact provider-issued value. Timeline requires canonical `whsec_` encoding with at least 24 decoded secret bytes and rejects hand-written weak values.

    RECALL_WORKSPACE_VERIFICATION_SECRET=whsec_...

Timeline verifies the exact raw request body, webhook id, and timestamp before parsing, rate limiting, bot lookup, or database access. Signatures more than five minutes from the server clock are rejected. See [Recall's request-authentication guide](https://docs.recall.ai/docs/authenticating-requests-from-recallai).

1.  **Status webhook.** In the Recall dashboard, configure the webhook URL to:

        https://thetimeline.cc/api/webhooks/recall/status

    Newer Recall accounts use the workspace secret above. Accounts created before 15 December 2025 may still require the endpoint-specific legacy Svix secret for dashboard status events; set it only in that compatibility case:

        RECALL_STATUS_WEBHOOK_SECRET=whsec_...

    When both are configured, Timeline accepts a status delivery signed by either secret without revealing which matched. The legacy secret never authenticates transcript events.

2.  **Transcript webhook**. We pass this URL to Recall on every `POST /bot` call. **By default it is derived from `AUTH_URL`** (your app's public origin, already required by Auth.js) plus the fixed route path, so most installs need no additional config — the bot posts to `${AUTH_URL}/api/webhooks/recall/transcript`. Hosted production permits an explicit `RECALL_TRANSCRIPT_WEBHOOK_URL` only when it has that same HTTPS origin, exact path, and no query or fragment. A different proxy, tunnel, or webhook ingress is a development or explicitly self-managed option:

        # Optional — defaults to AUTH_URL + /api/webhooks/recall/transcript
        RECALL_TRANSCRIPT_WEBHOOK_URL=https://thetimeline.cc/api/webhooks/recall/transcript

    The workspace verification secret authenticates this per-bot realtime endpoint. Additional defenses are:

    - **Bot id lookup** — the signed bot id is resolved to the meeting and team that Timeline recorded after its authenticated `joinMeeting` call.
    - **Zod validation** — malformed payloads are rejected.
    - **Rate limit** — 600 transcript events/minute per bot.

Timeline first writes an atomic transcript-closed timestamp under the same database lock used for chunk inserts, then asks Recall to leave. Buffered or late deliveries therefore cannot extend a cancelled capture while an existing partial transcript is being finalized. The UI acknowledges cancellation only after Recall confirms the leave; failed confirmations remain durable and the two-minute meeting scheduler retries them. Missed finalize enqueues remain recoverable by the worker janitor.

<span id="display-name"></span>

## 4. Bot display name

The bot still appears as a participant in silent mode. Timeline now sends a team-specific display name, such as `Acme's thetimeline.cc bot`, so another team on the same call can see whose bot joined. Names are truncated to Recall's 100-character limit while preserving the suffix. `RECALL_BOT_DISPLAY_NAME` remains the fallback when the team name is unavailable:

    RECALL_BOT_DISPLAY_NAME=Timeline

<span id="cost"></span>

## Cost guardrails

`team_meeting_settings.meeting_minutes_cap` sets a per-team monthly cap (default **600 minutes**). Set to `0` to disable bots for a team. Set to `null` for unlimited. Admins can toggle `meeting_minutes_admin_override` to ignore the cap during a launch / incident window.

Each finalised meeting writes a row to `meeting_usage`. The `scheduleMeetingBotAction` server action sums the current month's minutes before allowing a new bot to join.

<span id="privacy"></span>

## Privacy and consent

`team_meeting_settings.require_host_consent` (default **true**) forces the user manually scheduling the bot to tick a consent box confirming participants will be told the bot is recording. Saved Meetings store their own permission confirmation at creation time, and raw URL quick joins ask for prompt-specific confirmation before creating a meeting row.

Timeline does **not** copy raw meeting audio or video into Timeline-managed object storage. In Timeline-hosted mode, Recall temporarily processes and retains that recording media for one hour after the meeting completes so the high-quality multilingual transcript path remains available. Recall separately keeps operational logs for 7 days and removes the meeting URL 14 days after the bot terminates. Transcript text lands on the timeline; summary metadata is attached when OpenRouter generation succeeds.

<span id="local-dev"></span>

## Local development

Use ngrok or Cloudflare Tunnel to expose `localhost:3000` to Recall:

    ngrok http 3000
    # point RECALL_TRANSCRIPT_WEBHOOK_URL at the public ngrok URL

The Recall dashboard supports a test bot you can attach to a Meet you control. The transcript webhook fires within a few seconds of each utterance.

<span id="troubleshooting"></span>

## Troubleshooting

- **Meeting stuck in `joining`** — check Recall dashboard for the bot's status. Recall surfaces fatal errors (e.g. host blocked the join) on the bot detail page. If transcript chunks are landing but the status never advances, verify the Svix-signed status webhook is delivering bot lifecycle events to `/api/webhooks/recall/status`.
- **Saved Meeting stopped auto-joining** — Timeline retries the first in-window no-show once. A retry that misses the remaining call window becomes a terminal no-show. Three terminal scheduled no-shows or provider failures pause auto-join for that saved meeting. Re-enable it after checking the link and schedule.
- **No transcript chunks landing** — verify `RECALL_TRANSCRIPT_WEBHOOK_URL` is publicly reachable. Check the web app logs for `web:api:recall:transcript` entries.
- **401 on a Recall webhook** — signature or timestamp mismatch. Re-copy the same-region workspace secret into `RECALL_WORKSPACE_VERIFICATION_SECRET` and verify the web-service clock. For a pre-15-December-2025 dashboard status endpoint, also verify `RECALL_STATUS_WEBHOOK_SECRET`. The web app reports status and transcript verification failures to Sentry using content-free reason tags.
