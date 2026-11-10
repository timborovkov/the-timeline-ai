# Resend email

Resend powers transactional mail and inbound team capture. Account setup, credentials, sender verification, receiving domains, DNS, and webhook registration are operator-owned.

## Runtime configuration

    RESEND_API_KEY=
    RESEND_WEBHOOK_SECRET=
    SECRETS_ENCRYPTION_KEY=
    TRANSACTIONAL_EMAIL_FROM=
    SUPPORT_EMAIL=
    INBOUND_EMAIL_DOMAIN=

The API key needs sending and receiving access. Web needs the signing secret, API key, receiving domain, and Redis. The full worker needs the API key, receiving domain, Redis, database, and attachment/audio/document storage configuration. Sender settings are also needed wherever outbound mail is sent. Missing configuration is reported explicitly; no credentials are supplied by the repository.

Verification, password-reset, and invitation retry payloads are encrypted with the existing `SECRETS_ENCRYPTION_KEY` (32 bytes, base64). Configure it wherever these emails are sent; missing keys fail closed. Retries decrypt the original payload to preserve idempotency without storing plaintext access links.

Password recovery uses `AUTH_URL` for trusted reset links. Apply migration `0095_password_recovery` before deploying the web app. Reset links last 30 minutes, replace previous links, and sign out existing login sessions when redeemed. Verify delivery with a controlled password account after deployment. Recovery emails bypass workspace allowances; check failed `password_reset` delivery records without copying decrypted links into logs or support messages.

Team addresses are `<slug>@<INBOUND_EMAIL_DOMAIN>`. Use either your receiving domain or your Resend-managed subdomain. Existing team records must contain the intended address; this migration does not rewrite stored team data.

`TRANSACTIONAL_EMAIL_FROM` is the sender for all outgoing email, including invitations. `SUPPORT_EMAIL` is the support recipient and the contact address shown on public, help, legal, and trust pages. The Docker web image does not receive that value at build time, so prerendered pages load it from `/api/public/runtime` after paint. Without it, public links default to contact@thetimeline.cc and support requests are saved without email delivery.

Sender restrictions are enabled by default for new and existing teams. Active members can send from their account email; admins can add additional addresses or disable the restriction in team settings. Membership changes apply automatically. Existing extra addresses are preserved. Messages with failed receiver authentication are rejected when the restriction is enabled; unknown authentication retains the existing audit policy.

Audio replay reuses a stable transcription job and billing identity. Queued and completed audio is not submitted again; failed jobs can retry, and saved transcripts let interrupted workers resume downstream processing without another transcription request.

## Receiving

Register `email.received` at `https://<app-host>/api/email/inbound`. Use the signing secret supplied by Resend. The route verifies the raw body and Svix timestamp/signature, then queues only the email ID. It returns 503 if configuration or queueing is unavailable, 401 for invalid signatures, and 400 for malformed received-email events.

The `email-inbound` worker fetches bodies, headers, receiver-computed authentication, and attachments from Resend. Sender rate-limit admission runs before attachment listing or downloads and is memoized per logical email across retries. Temporary download URLs and attachment bytes never enter Redis jobs or source snapshots. Downloads reject unsafe destinations and redirects, and attachments have a cumulative 25 MiB limit. Oversized attachments receive explicit dropped reasons.

Recipient matching is restricted to the configured receiving domain. To, Cc, Bcc, and forwarded-recipient candidates can capture into multiple teams; each team's sender whitelist, visibility defaults, and billing admission apply independently. RFC Message-ID and reply headers preserve threading. Local reply stripping preserves forwarded chains. Documents and audio continue through extraction and transcription.

## Retries and operations

Worker concurrency is two, with eight attempts and exponential backoff starting at 30 seconds. Provider Retry-After is respected. Completed IDs remain for 24 hours, failures for seven days. Failed jobs are operator-visible; cross-team payloads are not exposed in team job views.

    bun run email:replay -- <received-email-uuid>

Run replay with the intended Redis configuration already exported. It can create captured events and resumes failed/completed jobs. Database deduplication and stable child identities prevent duplicate evidence and billing. Recovery metadata is read through the team scope using an explicit internal ingest principal. If an owner has restricted a captured parent to specific people, replay fails closed with `email_recovery_specific_users_requires_operator` before creating derived documents or audio children. The failed job remains operator-visible; recovery must not broaden the parent’s visibility.

## Outbound mail

Invitations, verification, welcome mail, support requests, digests, connection notices, and billing alerts use the shared Resend transport. Subjects, text, HTML, reply-to, preferences, and local delivery records remain application-owned. API acceptance is recorded as sent; it does not prove inbox delivery. Stable delivery IDs protect retries through Resend idempotency, with local deduplication retained beyond the provider window.

<span id="smoke-test"></span>

## Verification

Offline tests use mocked receiving APIs and synthetic signed webhooks. Live checks remain pending operator configuration. The integrations canary skips when credentials are absent. For an explicit replay check, configure `RESEND_INBOUND_CANARY_EMAIL_ID` to an existing synthetic received email addressed to a test team and set `RESEND_INBOUND_CANARY_ALLOWED_ORIGIN` to the exact AUTH_URL origin. The check signs a replay, waits for a captured event, and may find an already-captured event; it does not prove a new SMTP delivery.

## Privacy and trust

Resend processes recipients, senders, email content, attachments, and delivery metadata. A 2026-11-09 read-only account review verified domain `in.thetimeline.cc`, `eu-west-1` sending, inbound receiving, the `email.received` webhook, unused audiences/contacts/segments/broadcasts/topics/automations/templates, and domain-level open/click tracking currently enabled. Resend's published GDPR page states US storage regardless of sending region and 30-day Free/Pro/Scale email/log retention while the account is active (deleted within 90 days after termination). Timeline deletion does not itself delete Resend copies during that window. G-09 remains partial: do not claim a signed DPA on file, custom retention, API key scope, a plan name, or that tracking is off. Do not infer those remaining settings from a successful API response.

References: [Receiving](https://resend.com/docs/dashboard/receiving/introduction), [webhook signatures](https://resend.com/docs/webhooks/verify-webhooks-requests), [received-email API](https://resend.com/docs/api-reference/emails/retrieve-received-email).
