# Telegram bot setup

> Telegram is a first-party conversational surface. Direct text talks to the agent; explicit notes, group messages, voice/audio, and supported document/image attachments feed the evidence pipeline shared with Slack.

Create the bot, disable privacy mode so it can read group messages, point a secret-protected webhook at the web service, let startup register the `/` command menu, and link teams from inside the app.

<span id="create-bot"></span>

## 1. Create the bot

1.  Open Telegram, message [@BotFather](https://t.me/BotFather).
2.  `/newbot` → pick a name and username (must end in `bot`).
3.  Copy the **HTTP API token** BotFather gives you.

Set in `.env`:

    TELEGRAM_BOT_TOKEN=123456:ABC-...

<span id="privacy"></span>

## 2. Disable privacy mode

The bot needs to read every group message, not just `/commands`.

1.  In BotFather: `/mybots` → choose your bot → **Bot Settings** → **Group Privacy** → **Turn off**.

<span id="secret"></span>

## 3. Generate a webhook secret

This is a shared secret Telegram sends back in `X-Telegram-Bot-Api-Secret-Token` on every webhook call. Reject any request without it.

    openssl rand -hex 32

Set in `.env`:

    TELEGRAM_WEBHOOK_SECRET=<the_hex_string>

<span id="register"></span>

## 4. Register the webhook and command menu

**The web service does this automatically on startup.** The Next.js instrumentation hook at `apps/web/src/instrumentation.ts` runs once per server process in the Node runtime.

Command menu: if `TELEGRAM_BOT_TOKEN` is set, it calls `setMyCommands` for the default, private-chat, and group-chat scopes (idempotent on Telegram's side). That is what fills the Telegram `/` picker in bot DMs and groups. Direct messages get the DM command list (including `/note` and `/new`); groups get the group list. Typed commands still work even if the menu was never registered; `/help` prints the same catalog. Registration is fire-and-forget and runs in production and local `next dev`, because unlike `setWebhook` it does not need a public callback URL.

Webhook: in production (`NODE_ENV=production`), if `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, and `AUTH_URL` are all set, it always calls `setWebhook` (idempotent on Telegram's side, and the only way to push a rotated `TELEGRAM_WEBHOOK_SECRET` since `getWebhookInfo` doesn't return the stored secret), then verifies via `getWebhookInfo`. Registration is fire-and-forget — it never blocks server readiness. Missing env vars → logs a skip line and continues.

For local development (or to register the webhook manually):

    curl -F "url=https://thetimeline.cc/api/telegram/webhook" \
         -F "secret_token=$TELEGRAM_WEBHOOK_SECRET" \
         -F 'allowed_updates=["message","edited_message","callback_query"]' \
         "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook"

Expose the dev server via ngrok / cloudflared and point the webhook at the tunnel.

<span id="verify"></span>

## 5. Verify

    curl "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/getWebhookInfo"
    curl -H 'content-type: application/json' \
         -d '{"scope":{"type":"all_private_chats"}}' \
         "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/getMyCommands"

Webhook info should return your URL with `last_error_date: 0`. Command lookup should list the DM commands (`start`, `ask`, `note`, `new`, `join`, `link`, `team`, `whereami`, `unlink`, `help`). Use `{"type":"all_group_chats"}` to inspect the group menu, which omits `note` and `new`.

<span id="live-canary"></span>

## 6. Live canary

`bun run canary:integrations` calls Telegram's Bot API `getMe` when `TELEGRAM_BOT_TOKEN` is set. To prove capture end to end, configure a linked Telegram user canary:

    TELEGRAM_CAPTURE_CANARY_USER_ID=710000001
    TELEGRAM_CAPTURE_CANARY_USERNAME=timeline_canary
    TELEGRAM_CAPTURE_CANARY_FIRST_NAME=Timeline
    TELEGRAM_CAPTURE_CANARY_ALLOWED_ORIGIN=https://thetimeline.cc

The canary posts a synthetic private-message `/note` update to `AUTH_URL/api/telegram/webhook` with `X-Telegram-Bot-Api-Secret-Token`, then polls `DATABASE_URL` for a matching `raw_events.source='telegram'` row. The Telegram user id must already be linked to an active Timeline team in the same database.

<span id="username"></span>

## 7. Optional: bot username for deep links

Set `TELEGRAM_BOT_USERNAME` (without the leading `@`) so the team settings page can render `t.me/<bot>?start=<token>` and `t.me/<bot>?startgroup=<token>` deep links. Find it in BotFather under `/mybots` → your bot.

    TELEGRAM_BOT_USERNAME=YourBot

<span id="e2e"></span>

## 8. End-to-end local test (ngrok)

The bot is gated off when `TELEGRAM_WEBHOOK_SECRET` is unset — the route at `/api/telegram/webhook` returns 503. To exercise the full flow on your machine you need a public URL.

    # Terminal 1: run the web app
    bun run dev

    # Terminal 2: expose it
    ngrok http 3000

    # Terminal 3: register the webhook with the secret (command menu is registered by bun run dev)
    curl -F "url=https://<ngrok-id>.ngrok-free.app/api/telegram/webhook" \
         -F "secret_token=$TELEGRAM_WEBHOOK_SECRET" \
         -F 'allowed_updates=["message","edited_message","callback_query"]' \
         "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook"

Then in the app:

1.  Sign in, open **Connections**, then the Telegram provider sheet.
2.  Click **Generate personal link**. Copy the `/link <token>` snippet.
3.  DM your bot on Telegram, paste the snippet. The bot replies with the linked team.
4.  Send any ordinary text message. The bot should react with `🤔`, keep typing while the durable worker runs, and reply to that message. Open `/app/chat` to find the same private Telegram conversation and transcript.
5.  Run `/note <text>`. The bot reacts with `👀`, and the note appears on `/app/timeline`, attributed to your user under the active team. Editing an ordinary agent prompt does not rerun it; editing a captured note replaces the visible source revision while preserving the immutable prior raw event.
6.  Use the trash icon on the Telegram timeline row. Authors and team admins can remove it from the active timeline; the raw event remains tombstoned rather than physically deleted.
7.  `/whereami` confirms routing; `/team` lists every current Timeline membership, including teams never previously selected in Telegram; `/team 2` switches to the second. A real switch archives the prior private conversation.
8.  `/ask <question>` remains an alias for an ordinary DM agent turn. `/new` archives the active Telegram chat session and starts cleanly on the next question. Agent turns are limited to 10 per user per minute, one at a time per DM, and 180 seconds. Answers are persisted before Telegram delivery, so a delivery retry does not pay for a second model run. If the original prompt is deleted before the worker finishes, Telegram sends the cached answer as a normal message instead of dropping it. Replies use the shared external-chat profile: concise plain text by default, without raw Timeline citation ids or a source footer. Ask explicitly for a full breakdown when needed, or continue the conversation in web chat for rich, clickable evidence links.
9.  Shared URLs in captured text are normalized into non-authoritative artifact evidence. The canonical URL groups timeline context for the same link, while display-only URL text does not merge separate resources that differ by meaningful query parameters.
10. Emails, phone numbers, and conservative labeled addresses in captured text are stored on `source_metadata.contacts`. Accepted email/phone memory becomes person identity facets rather than link-like artifact rows.

For groups: have a team admin generate a **group** token, add the bot to a Telegram group, then have a group admin run `/link <token>` inside the group. Every subsequent text message in that group flows to the team timeline, and any Telegram sender in the bound group can use `/ask` against team-visible history even before linking a personal Timeline identity. An unlinked sender runs as the synthetic team agent: it may use enabled team-shared custom MCP tools and create new team-visible approval proposals, but cannot revise/approve proposals, use personal tools, or mutate canonical Timeline state. Enabled team-shared custom MCP tools can still cause external side effects. Linked members keep their normal member-level agent behavior. Unlinked direct messages remain blocked.

Messages from Telegram users who have not linked yet are recorded with `source_metadata.source_unverified = true` and a null `author_user_id`. Sender and chat context are still recorded in metadata and rendered into extraction/embedding text.

Attachments use the shared conversational guardrails: up to 25 MiB, at most five processed files per message, native voice messages routed to transcription, and supported text/image/PDF/DOCX/CSV/JSON/XML/YAML/Markdown/HTML/log files captured as source evidence and routed to typed extraction representations. Archives, executables, video, oversize files, and unknown binary files are skipped. Ambiguous `.mp4`/`.webm` files enter transcription when Telegram provides an `audio/*` content type or a recognized audio extension such as `.m4a`, `.mp3`, or `.ogg`.

<span id="schema"></span>

## Schema reference

Telegram routing still uses four provider tables:

- `telegram_users` — one row per Telegram user the bot has seen; optional link to an app `users.id` once the user `/link`s a personal token.
- `telegram_user_teams` — the selected DM route. It is not an eligibility list; `team_members` supplies every currently available team. A partial unique index guarantees exactly one `is_active=true` row per Telegram user.
- `telegram_chat_bindings` — one row per Telegram group/supergroup chat, pointing at a single team. Permanent until `/unlink`.
- `telegram_link_tokens` — single-use, 15-minute-TTL tokens, scoped `personal` (DM link) or `group` (group binding).

### Group upgrades

When Telegram upgrades a group to a supergroup, migration messages or outbound errors update its binding and the same workspace’s digest destination. Migration requires confirmed workspace ownership; a leftover destination after unlink is not authorization. Conflicting ownership fails closed, and existing new-chat delivery records prevent duplicate digests. Locking and retry details live in `packages/shared/src/telegram/chat-migration.ts` and its tests.

Private agent state is provider-neutral: `chat_sessions.surface='telegram'`, `chat_surface_session_links` maps the opaque Telegram DM key to the active session, and `chat_surface_turns` is the durable idempotency, model, and delivery ledger consumed by the `conversation-agent` worker queue.

Daily digest delivery uses the same bot: a workspace can post the team-visible digest to a bound group, or DM every linked member. Configure destinations in Team settings → Preferences. The bot can only DM people who have already started a conversation with it.

Website capture: `/crawl <url>` shows the cost and permission statement; `/crawl <url> confirm` starts it for the linked team. See [website sources](../websites.md).
