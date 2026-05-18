# Postmark inbound email setup

> Inbound email ingest ships in **Phase 7**. You can set the env vars now;
> nothing in Phase 1 reads them.

## 1. Account + server

1. Sign up at <https://postmarkapp.com>.
2. Create a **server** named "Timeline".
3. Copy the **Server API Token**.

Set in `.env`:

```bash
POSTMARK_SERVER_TOKEN=...
```

## 2. Inbound stream

1. In the server, go to **Inbound** → set up an inbound stream.
2. Set the inbound webhook URL to:

   ```
   https://<your-app-domain>/api/email/inbound
   ```

3. Enable **Include raw email content in JSON payload**.
4. Set the **Include attachments** option to **Yes**.

## 3. Webhook signature secret

Postmark signs the inbound payload. We verify the signature on every request.

```bash
openssl rand -hex 32
```

Set in `.env`:

```bash
POSTMARK_WEBHOOK_SECRET=<the_hex_string>
```

(Add this same value as the webhook's basic-auth password in Postmark.)

## 4. Inbound email domain

Each team gets `<team-slug>@in.thetimeline.app`. Map your inbound MX domain in
Postmark.

```bash
INBOUND_EMAIL_DOMAIN=in.thetimeline.app
```

## 5. Smoke test

Postmark dashboard has a test inbound email feature. Send a test message; the
app should write a `raw_events` row with `source='email'`.
