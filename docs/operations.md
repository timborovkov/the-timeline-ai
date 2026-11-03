# Operations reference

Deployment notes for maintainers. See [local setup](setup/local.html),
[Railway deployment](railway.html), and [provider setup](index.html) for configuration.

## Email delivery and capture

Inbound email is restricted to active member account addresses and editable extra
senders by default; team admins can disable this restriction. Membership changes
apply automatically.

Resend handles transactional email and inbound capture. The signed
`/api/email/inbound` webhook queues IDs into `email-inbound`; the full worker
retrieves bodies and bounded attachments, applies team routing and sender rules,
and resumes extraction/transcription safely on retry. See
[Resend configuration and replay](setup/resend.html) for the required
variables and `bun run email:replay -- <received-email-uuid>`. Credentials, domain
configuration, and live verification are operator-owned. No live email settings
are supplied by the repository.

## Internal queue readiness

`GET /api/health/ready` requires `Authorization: Bearer <CRON_SECRET>` and returns `Cache-Control: no-store`. It checks extraction, embedding, integration sync and webhook-delivery workers and waiting-job age. Missing workers, waiting work older than 30 minutes, dependency failures or a five-second probe timeout return 503. This complements public `/api/health`; it does not certify answer quality, active-job progress, every queue or billing reconciliation. Never place the secret in a URL or public monitor.

## Password recovery

Email/password users can follow “Forgot password?” from sign-in to request a
single-use reset email. Links expire after 30 minutes; requesting another replaces
the previous link. A successful reset signs out every existing application session
and requires a fresh login. GitHub-only accounts continue using GitHub.

Recovery uses the existing `RESEND_API_KEY`, `TRANSACTIONAL_EMAIL_FROM`,
`SECRETS_ENCRYPTION_KEY`, trusted `AUTH_URL`, database, and Redis configuration.
Apply migration `0095_password_recovery` before rolling out the web app. It adds
reset-token storage, a user session version, and the reset-email message intent.
Old JWTs remain valid as version zero until their account resets its password.
Recovery emails bypass workspace email allowances; delivery failures use existing
message-delivery records and sanitized monitoring events. Monitor failed deliveries
and `password_reset_request_failed` / `password_reset_failed` events after rollout.

## Platform administration

Verified accounts in `PLATFORM_ADMIN_EMAILS` can open `/app/admin` to browse and manage users and teams, suspend/restore access, and start audited 30-minute user impersonation sessions. See [Platform administration](platform-admin.md) for access boundaries, migration, and operator guidance.
