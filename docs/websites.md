# Website sources

Website sources capture public same-origin pages through Firecrawl. The shared
`websites` domain owns admission, durable runs, schedules and credential checks;
onboarding, bots, HTTP and MCP are adapters. All workspace access remains team
scoped. Captured evidence is immutable; canonical changes require approval.

## Capture and versions

Onboarding creates or reuses the same persistent source shown in Sources →
Websites and calls the shared scan service with `trigger: onboarding`. It defaults
to manual refresh; administrators can schedule it afterward. Leaving onboarding
keeps the source and its scan history. An unchanged onboarding scan uses the
existing page citation to advance onboarding without creating duplicate evidence.
The separate legacy adapter only finishes jobs admitted before migration; new
onboarding scans use the persistent worker. Terminal failures update only the
matching in-progress onboarding scan, including trusted cleanup after actor revocation.

Members can add a source and scan after confirming permission. The website manager uses in-app confirmation dialogs for scanning and removing sources; cancelling sends no mutation. Administrators
manage schedules, pause and archive sources. Archiving stops new work and retains
evidence; it is not erasure. Public URLs pass the existing SSRF guard. Scans read
at most five pages, without external links, subdomains or authenticated content.

`websites` holds configuration; `website_runs` holds admission, actor/credential
provenance, frozen billing policy, status and usage. Existing `website_sources`
rows remain immutable provider checkpoints/snapshots. `website_pages` links a
normalised page URL to its stable document and current ready version. Historical
onboarding captures are associated without rewriting their events or billing.

Changed pages create document versions and cited web events. Unchanged pages
still consume crawl units but skip extraction and embedding. A document version
becomes current after all its chunks embed. A handoff checkpoint prevents early
embedding completion from completing a partially persisted scan. Failed or
missing pages retain prior ready versions; capped results cannot prove deletion.
Default event/document vector searches exclude non-current website evidence
before result limits. Date-scoped historical searches and explicit citations
remain available. Timeline moments group changed pages by scan. Promoting a capture
to the document drive detaches it from managed crawling: later scans create a new
capture and cannot replace the promoted document’s edited or private content.
The promoted document remains searchable even when a later scan supersedes its
original website evidence.

Capture time is an observation date, not proof that a page’s claims were newly authored.
Search uses the weaker observation-date freshness signal when no trustworthy source
revision date is available. See [retrieval freshness and conflicting evidence](relational-memory.md#read-time-freshness-and-disagreements) for the shared ranking and authority contract.

## Billing and safeguards

The `accepted_sources` meter charges **20 source units per captured page**,
including unchanged pages and ingestion. AI and retained storage remain separate.
Reserve 100 units before a five-page scan; settle persisted page outcomes once.
Retries reuse the same operation ID, provider crawl ID and immutable page cache.
Legacy admissions retain one unit per page. No new Polar meter is introduced.

Provider credits, when returned by Firecrawl, are recorded separately from source
units. Unknown provider credits must not be inferred as zero. Actual account costs
and marginal credit pricing require account verification; failed/unusable crawls
can incur supplier costs without creating billable captured pages.

Operational defaults are five pages/run, 100 active sources/team, one active
run/team, one-hour source cooldown, and 10,000 provider-admitted page attempts per
team in a rolling day. Global leases allow two provider crawls, at most one per
hostname, with ten seconds between starts for a hostname. Limits apply across
entry points; paid source capacity, costly-worker limits and spending admission
still apply. `WEBSITE_CRAWLS_DISABLED=true` stops new provider work.

An ambiguous provider POST is never blindly repeated. A durable provider-start
marker without a crawl checkpoint fails with `provider_acceptance_unknown`.
Known jobs resume; up to three transient retries after the first attempt honour Retry-After. Unused queued
reservations are released on pause/removal. In-flight provider cancellation is
best effort; already captured usage remains billable.

## Schedules and delivery

Daily and weekly schedules use the explicitly displayed team timezone, local time
(default 09:00) and weekday (default Monday). Temporal calendar arithmetic handles
DST. A due-time identity permits one catch-up run, not a backlog of missed runs.
`WEBSITE_SCHEDULES_ENABLED` defaults false; the scheduler still recovers queued
work and reconciles completion while recurring capture is disabled.

Scheduled work rechecks its original administrator or scoped credential. Runs and
schedules created during impersonation retain their operator-session identity;
recovery and execution revalidate that session. An expired session terminates
pending work or pauses the schedule rather than continuing as the customer. Billing
blocks are visible on the source and generate one in-app notification per episode.
The next due time retries billing; explicit pauses require resumption. Stale work
is terminalized after one day instead of permanently holding a team's active slot.

Telegram `/crawl <url>` and Slack `/timeline crawl <url>` show the usage/permission
statement; appending `confirm` explicitly starts the scan. Bot completion delivery
uses an encrypted outbox, then the existing encrypted Redis delivery queue. The
outbox is removed after enqueue, or expires one day after completion (at most two days from creation). Messages link to scan
status without copying captured content.

## HTTP and MCP

HTTP endpoints use the signed-in active team with same-origin mutation checks, or
existing MCP bearer credentials (resource `/api/mcp/server`). Credentials must be
explicitly granted website scopes; existing grants do not gain them automatically.

- `GET /api/websites`: list active sources.
- `POST /api/websites`: create `{url, subject, permissionConfirmed: true}`; does not scan.
- `GET /api/websites/:id`: source and recent run history.
- `PATCH /api/websites/:id`: schedule and/or paused state; admin authority required.
- `DELETE /api/websites/:id`: archive source; admin authority required.
- `POST /api/websites/:id/scans`: `{permissionConfirmed: true}` and an
  `Idempotency-Key` header; returns 202 with run and status URL, or 409 when billing blocks.
- `GET /api/websites/:id/scans/:runId`: team-scoped scan status.

Read requires `read`; adding/scanning requires `websites:scan`; configuration and
removal require `websites:manage` plus current admin authority. Static keys retain
synthetic attribution. Queued work stores credential identifiers, never plaintext
bearer tokens, and revalidates the grant/key before provider work.

MCP exposes `timeline.crawl` with URL, subject, permission confirmation and stable
idempotency key; `timeline.crawl_status` takes a run ID. Search never initiates a
paid crawl. Schedule management remains in the app/HTTP API.

## Rollout and deletion

Apply the additive migration before consuming new jobs. Keep scheduling disabled
until one-off scans, weighted Polar sandbox reporting, provider concurrency,
retention/DPA evidence and operational monitoring have been checked. Deployment
and legal approval are separate from a source change. Material terms/privacy
updates use the shared legal versions and require renewed presentation.

The public pricing calculator reuses the multiplier and billing preview. It uses
30 daily or five weekly scans for a 30-day estimate; manual scans are explicit.
Crawling is counted once in source usage. See [billing](architecture/billing.md),
[provider register](providers.md), [security gaps](security-gaps.md), and
[manual support deletion](setup/manual-support-deletion.md).

## Operational configuration and reconciliation

The safety defaults can be changed through `WEBSITE_MAX_SOURCES`,
`WEBSITE_MAX_DAILY_PAGES`, `WEBSITE_COOLDOWN_MS`, `WEBSITE_GLOBAL_CONCURRENCY`
and `WEBSITE_HOST_DELAY_MS`. Keep the five-page boundary fixed. Verify the
Firecrawl account limits before raising concurrency above two. Set
`FIRECRAWL_COST_EUR_PER_CREDIT` from the contracted supplier price (including the
chosen currency conversion); absent that evidence, estimated supplier cost is
unknown, never zero. Run records expose provider credits and estimated EUR cost
independently of customer units, including unusable terminal results.

An ambiguous provider POST emits an error with team/run identifiers and retains
its global and hostname slot. Alert on `provider_acceptance_unknown` and terminal
runs with `provider_started_at IS NOT NULL AND provider_finished_at IS NULL`.
Never automatically clear these slots or resubmit the crawl. An operator must
check the Firecrawl account activity, cancel any matching crawl, and confirm no
provider work remains. If the provider cannot establish that, keep the slot and
escalate to the provider; do not increase concurrency to bypass it.

After that check, an authorized database operator may release the specific
terminal slot with this parameterized statement, recording the provider evidence
and run ID in the incident record. This does not retry the scan or alter billing:

```sql
UPDATE website_runs SET provider_finished_at = now()
WHERE team_id = $1 AND id = $2 AND finished_at IS NOT NULL
  AND provider_started_at IS NOT NULL AND provider_finished_at IS NULL;
```

Trusted worker recovery settles validated cached pages using their frozen run
multiplier before releasing unused reservation capacity, including after pause,
archive or actor revocation. It cannot admit new work. This uses the existing
billing maintenance boundary so suspended-team cleanup does not evade incurred
usage.

## Team lifecycle

Team disabling blocks website reads, new captures, scheduled scans and result delivery. Configuration and evidence remain available after restoration. The lifecycle worker cancels admitted runs and settles only persisted page outcomes; unconfirmed provider cancellation keeps cleanup pending and retryable. Permanent erasure removes source configuration, runs, page links, encrypted notification outboxes, captured evidence and queued payloads through the [team lifecycle workflow](platform-admin.md#team-deletion-lifecycle).
