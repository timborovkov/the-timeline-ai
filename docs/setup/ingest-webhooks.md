# Ingest webhooks

Ingest webhooks are named evidence-only sources for arbitrary provider payloads: JSON, XML, text, form bodies, or any other text-like content. They do not require a provider-specific schema and never become authoritative state by themselves. Accepted deliveries are normalized into reconciliation evidence before downstream extraction; the AI extraction pipeline can then turn them into facts, citations, embeddings, and approval proposals.

1.  Go to `/app/connections/developer` as a team admin, open the **Developer** tab, and open **Ingest webhooks**.
2.  Create a named webhook, for example *Pipedrive webhook*. Choose whether new events default to team-visible evidence or private evidence owned by the creating admin. Choose a **Timeline type** so the archive knows how to weigh the delivery: conversation, work record, status pulse (the default), incident, document, or schedule. Pulse is the right default for unknown or telemetry-like payloads; pick work record when the webhook represents a named object such as a deal or ticket. The type is presentation-only and never promotes the payload into workspace object identity.
3.  Copy the one-time secret URL or bearer token. Plaintext credentials are shown once; stored credentials are SHA-256 hashes and can be rotated without changing the webhook source.
4.  Configure the third-party provider to send `POST` requests to the copied URL. Providers that cannot store the key in the URL can call `/api/webhooks/ingest` with `Authorization: Bearer tli_...`.
5.  Keep proposal generation enabled when the source may contain task, date, object, or relationship evidence. Disable it when the source should only land searchable evidence. The worker checks the current setting again before processing queued proposal jobs.

The public endpoint rate-limits both authentication attempts and accepted deliveries, dedups identical same-day deliveries per webhook, redacts sensitive request headers from metadata, enforces the payload size cap while reading the request body, and rejects binary/multipart uploads for now. URLs in accepted payload text are normalized into non-authoritative link artifact evidence, and emails, phone numbers, and conservative labeled addresses are stored on `source_metadata.contacts`. Duplicate delivery replay repairs missing link evidence for the existing raw event; contact metadata is captured when the raw event is first accepted. Payload text is fenced as external content before extraction and proposal prompts, so sender-authored instructions remain evidence instead of agent instructions. Documents and rich files should still go through the document drive until binary webhook ingestion is intentionally designed.

<span id="mcp"></span>

Shared prerequisites, health and resync: [integrations](integrations.md).
