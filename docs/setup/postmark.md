# Postmark inbound email setup

Per-team email ingest. A team's address is `<team-slug>@<INBOUND_EMAIL_DOMAIN>`,
populated automatically on team creation. Forward, CC, or BCC any mail to that
address and it lands in the timeline.

## 1. Account + server

1. Sign up at <https://postmarkapp.com>.
2. Create a **server** named "Timeline".
3. Copy the **Server API Token**.

```bash
POSTMARK_SERVER_TOKEN=...
```

(Not used by the inbound webhook today — kept in env for the Phase 8 outbound
work.)

## 2. Inbound stream

1. In the server, go to **Inbound** → set up an inbound stream.
2. Set the inbound webhook URL to:

   ```
   https://<your-app-domain>/api/email/inbound
   ```

3. Enable **Include raw email content in JSON payload**.
4. Set the **Include attachments** option to **Yes**.

## 3. Webhook authentication (Basic Auth)

We verify every inbound request via HTTP Basic Auth. Postmark sends the
configured user/password in the `Authorization` header; the handler compares
in constant time against `POSTMARK_WEBHOOK_SECRET`.

```bash
openssl rand -hex 32
```

```bash
POSTMARK_WEBHOOK_SECRET=<the_hex_string>
```

In the Postmark dashboard, set the webhook URL with credentials embedded:

```
https://postmark:<the_hex_string>@<your-app-domain>/api/email/inbound
```

(Either `user:secret` or `:secret` is accepted; the secret can be in either
position. The matched value must equal `POSTMARK_WEBHOOK_SECRET` exactly.)

## 4. Inbound email domain

Each team gets `<team-slug>@<INBOUND_EMAIL_DOMAIN>`. Configure MX records for
that domain to point at Postmark.

```bash
INBOUND_EMAIL_DOMAIN=in.thetimeline.app
```

Teams created before Phase 7 are backfilled to `<slug>@inbound.invalid`. Run
a one-off `UPDATE teams SET inbound_email = slug || '@in.thetimeline.app'` if
you need to flip a legacy team to the production domain.

## 5. What gets ingested

For each inbound delivery the dispatcher:

1. Parses the Postmark payload (Zod schema).
2. Resolves which team(s) the message was addressed to via `teams.inbound_email`.
   Multiple recipients land as multiple rows, one per team.
3. Looks up the From address against `users.email` joined to `team_members`.
   Match → attributed to that user. No match → row lands with
   `authorUserId=null` and `source_metadata.sender_unverified=true`.
4. Strips quoted-reply chains for `content_text`; preserves the original
   `TextBody` / `HtmlBody` in `source_metadata.raw_postmark` so re-extraction
   can replay against the full thread.
5. Parses `In-Reply-To` and `References` headers and links the row to its
   thread via `source_metadata.thread_root_id`.
6. Routes attachments by content-type:
   - `audio/*` → `timeline-audio` bucket + a child raw_event + transcribe job.
   - Everything else → `timeline-attachments` bucket; recorded on the parent
     event's `source_metadata.attachments[]`.
7. Enqueues extract + embed for the parent event.

Idempotency: a partial unique index on `(team_id, source_metadata->>'message_id')`
makes Postmark retries silent no-ops.

## 6. Smoke test

Postmark dashboard has a test inbound email feature. Send a test message; the
app should write a `raw_events` row with `source='email'`. The timeline UI shows
the subject + from header; the entity profile pages link the new event.
