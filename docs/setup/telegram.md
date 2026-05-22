# Telegram bot setup

> Bot integration ships in **Phase 2** (text only). Voice memos land in Phase 3.

## 1. Create the bot

1. Open Telegram, message [@BotFather](https://t.me/BotFather).
2. `/newbot` → pick a name and username (must end in `bot`).
3. Copy the **HTTP API token** BotFather gives you.

Set in `.env`:

```bash
TELEGRAM_BOT_TOKEN=123456:ABC-...
```

## 2. Disable privacy mode

The bot needs to read every group message, not just `/commands`.

1. In BotFather: `/mybots` → choose your bot → **Bot Settings** → **Group
   Privacy** → **Turn off**.

## 3. Generate a webhook secret

This is a shared secret Telegram sends back in `X-Telegram-Bot-Api-Secret-Token`
on every webhook call. Reject any request without it.

```bash
openssl rand -hex 32
```

Set in `.env`:

```bash
TELEGRAM_WEBHOOK_SECRET=<the_hex_string>
```

## 4. Register the webhook (once per environment)

**The web service does this automatically on startup.** The Next.js
instrumentation hook at [`apps/web/src/instrumentation.ts`](../../apps/web/src/instrumentation.ts)
runs once per server process. In production (`NODE_ENV=production`), if
`TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, and `AUTH_URL` are all set,
it calls `getWebhookInfo` and re-registers via `setWebhook` whenever the URL
doesn't match or Telegram is reporting a recent delivery error. Registration
is fire-and-forget — it never blocks server readiness. Missing env vars →
logs a skip line and continues.

For local development (or to register manually):

```bash
curl -F "url=https://<your-app-domain>/api/telegram/webhook" \
     -F "secret_token=$TELEGRAM_WEBHOOK_SECRET" \
     -F 'allowed_updates=["message","edited_message","callback_query"]' \
     "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook"
```

Expose the dev server via ngrok / cloudflared and point the webhook at the
tunnel.

## 5. Verify

```bash
curl "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/getWebhookInfo"
```

Should return your URL with `last_error_date: 0`.

## 6. Optional: bot username for deep links

Set `TELEGRAM_BOT_USERNAME` (without the leading `@`) so the team settings page
can render `t.me/<bot>?start=<token>` and `t.me/<bot>?startgroup=<token>` deep
links. Find it in BotFather under `/mybots` → your bot.

```bash
TELEGRAM_BOT_USERNAME=YourBot
```

## 7. End-to-end local test (ngrok)

The bot is gated off when `TELEGRAM_WEBHOOK_SECRET` is unset — the route at
`/api/telegram/webhook` returns 503. To exercise the full flow on your
machine you need a public URL.

```bash
# Terminal 1: run the web app
pnpm dev

# Terminal 2: expose it
ngrok http 3000

# Terminal 3: register the webhook with the secret
curl -F "url=https://<ngrok-id>.ngrok-free.app/api/telegram/webhook" \
     -F "secret_token=$TELEGRAM_WEBHOOK_SECRET" \
     -F 'allowed_updates=["message","edited_message","callback_query"]' \
     "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook"
```

Then in the app:

1. Sign in, open **Team → Manage Telegram links**.
2. Click **Generate personal link**. Copy the `/link <token>` snippet.
3. DM your bot on Telegram, paste the snippet. The bot replies with the
   linked team.
4. Send any text message. Open `/app/timeline` — it should appear, attributed
   to your user under the linked team.
5. `/whereami` confirms attribution; `/team` lists linked teams; `/team 2`
   switches to the second; the next DM message lands on the new team.

For groups: have a team admin generate a **group** token, add the bot to a
Telegram group, then have a group admin run `/link <token>` inside the group.
Every subsequent text message in that group flows to the team timeline.

Messages from Telegram users who have not linked yet are recorded with
`source_metadata.source_unverified = true` and a null `author_user_id`.

## Schema reference

Phase 2 adds four tables:

- `telegram_users` — one row per Telegram user the bot has seen; optional
  link to an app `users.id` once the user `/link`s a personal token.
- `telegram_user_teams` — DM-time team memberships. Partial unique index
  guarantees exactly one `is_active=true` row per Telegram user.
- `telegram_chat_bindings` — one row per Telegram group/supergroup chat,
  pointing at a single team. Permanent until `/unlink`.
- `telegram_link_tokens` — single-use, 15-minute-TTL tokens, scoped
  `personal` (DM link) or `group` (group binding).
