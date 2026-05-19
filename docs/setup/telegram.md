# Telegram bot setup

> Bot integration ships in **Phase 2**. You can set the env vars now; nothing
> in Phase 1 reads them.

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

Run after deploy:

```bash
curl -F "url=https://<your-app-domain>/api/telegram/webhook" \
     -F "secret_token=$TELEGRAM_WEBHOOK_SECRET" \
     -F 'allowed_updates=["message","edited_message","callback_query"]' \
     "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook"
```

For local development, expose the dev server via ngrok / cloudflared and point
the webhook at the tunnel.

## 5. Verify

```bash
curl "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/getWebhookInfo"
```

Should return your URL with `last_error_date: 0`.
