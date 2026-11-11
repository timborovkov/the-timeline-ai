# Security, privacy, and trust operating standard

| Field | Value |
| --- | --- |
| Status | Normative internal standard |
| Applies to | Hosted Timeline, public Timeline surfaces, development, support, and vendor operations |
| Service operator | Nyxone OÜ, Estonian registry code 16172329 |
| Control owner | **TBD: named security/privacy owner** |
| Version | 2026-11-10 |
| Last evidence review | 2026-08-27 |
| Next scheduled review | **TBD: no later than 2026-11-27** |
| Evidence memo | [Provider privacy and data-handling research](evidence/provider-privacy-research.md) |
| Legal research | [GDPR, cookies, and consent audit](evidence/gdpr-cookie-consent-audit-2026-08-21.md) |
| Google OAuth readiness | [Drive and sign-in scopes, callbacks, APIs](./research/google-oauth-readiness.md) |
| Analytics interface | [Privacy and analytics implementation interface](./privacy-analytics-interface.md) |
| Public derivatives | Trust page, Privacy Policy, Cookies and similar technologies notice, Terms of Use, help, guides, sales and security answers |

This is the core operating contract for how Timeline handles data. Agents,
developers, operators, support staff, marketers, and counsel must use it when a
change affects data collection, access, inference, storage, telemetry,
permissions, retention, deletion, providers, public claims, or legal terms.

The Trust page may simplify this document, and legal policies may express it in
binding language, but neither may invent a stronger control. When code,
deployment state, contracts, and this standard disagree, treat the discrepancy
as a security or documentation defect. Describe only the weakest state that is
currently evidenced.

This document is an internal policy and engineering standard, not legal advice.
The Privacy Policy, Terms of Use, data processing agreements, and regulated-use
commitments require counsel review.

## 1. Decision rule and evidence states

The hosted service is not accurately described as “fully private.” Customer
content is stored by Timeline and processed by necessary service providers,
sometimes transiently and sometimes under a disclosed retention period. The
useful commitments are narrower and testable: who receives which data, for what
purpose, under which access, training, retention, security, and deletion
controls.

Use these states in reviews and internal records:

| State | Meaning |
| --- | --- |
| **Enforced** | A repository control or repeatable technical test prevents a weaker state. |
| **Verified** | Current deployment, provider-account, or contract evidence has been captured and dated. |
| **Required** | This standard mandates the behavior, but implementation or operating evidence may still be open. |
| **Conditional** | The data flow exists only when a feature or provider is configured or selected. |
| **Gap** | The control or evidence is incomplete. A related public claim is blocked. |

Repository code can establish **Enforced**, but it cannot by itself establish a
production region, account retention setting, signed DPA, staff-access history,
or successful deletion from backups. A checkbox or environment variable that
attests to an external setting is a deployment gate, not independent proof that
the setting remains correct.

### Public-copy maintenance

Public pages and machine-readable summaries describe customer-relevant behavior,
policy, and limitations. Keep deployment checklists, evaluation plans, and evidence
collection tasks in this standard and its evidence register rather than public copy.
Removing an internal note does not close its gap or permit a stronger assurance.
Preserve provider retention exceptions, consent choices, regulated-use limits, and
the distinction between requested retention and confirmed deletion.

Current legal versions are owned by `packages/shared/src/legal-versions.ts`. Editorial maintenance does not close evidence gaps or constitute legal approval.

## 2. Scope, roles, and responsibility

This standard covers:

- public visitors and support contacts;
- user identities, authentication, invitations, legal acceptance, and team
  membership;
- workspace events, messages, files, voice notes, meetings, transcripts,
  documents, vectors, derived facts, AI prompts and outputs;
- native integrations, chat surfaces, webhooks, MCP servers, and outbound MCP;
- hosted infrastructure, logs, product analytics, error monitoring, email, and
  anti-abuse services;
- human access by Timeline personnel and provider support personnel; and
- self-managed or customer-controlled deployments offered under a separate
  written license or agreement.

The working legal-role model is:

- Nyxone OÜ acts as controller for its public site, account administration,
  security, support, and its own legitimate business operations.
- For workspace content submitted by an organization, the organization normally
  determines purpose and scope, while Nyxone OÜ processes that content to provide
  Timeline. Contracts and applicable law control the final role allocation.
- A customer-selected provider remains subject to that customer's account,
  instructions, and provider terms. Calling it “customer-directed” does not remove
  Timeline's duty to explain what is sent, what is copied, and how to disconnect
  or delete it.
- A self-managed operator becomes responsible for its deployment, access,
  backups, providers, retention, security, and notices. Self-management does not
  automatically remove OpenRouter, Recall.ai, Resend, Daytona, Firecrawl, or
  connected services.

## 3. Data classification

Derived data inherits the highest classification and narrowest visibility of
its sources. A summary, embedding, error trace, export, or model response is not
less sensitive merely because it is derived.

| Class | Examples | Minimum handling |
| --- | --- | --- |
| **Public** | Published website copy, public guides, intentionally public source files | Integrity review; no secrets or customer identifiers |
| **Internal** | Roadmaps, non-public architecture, vendor reviews, incident plans | Team-authorized access; no public sharing without review |
| **Account data** | Name, email, authentication metadata, team membership, legal acceptance, support correspondence | Purpose limitation, access control, documented retention and rights handling |
| **Customer metadata** | Team and object IDs, timestamps, usage counts, provider resource identifiers | Team scope; minimize in logs and analytics; never treat as anonymous by default |
| **Customer content** | Messages, events, files, documents, transcripts, prompts, outputs, imported records | Team plus item visibility; approved processors only; no advertising or model training use |
| **Restricted customer content** | Health, HR, financial, legal, biometric, political, union, sexual-orientation, credential, or regulated material | Written contract/control coverage before intentional hosted use; never market unsupported regulated readiness |
| **Secrets** | Password hashes, OAuth refresh tokens, bearer keys, webhook secrets, encryption keys | Approved secret store or application encryption; never analytics, logs, prompts, screenshots, fixtures, or source control |

Customer content may be `team`, `private`, or `specific_users`. This visibility
is part of the data classification. Moving data to a broader visibility is a
security-sensitive operation, including when data is summarized, embedded,
exported, cached, or sent to an agent.

Until the Railway and Daytona contractual gaps in the [security gap register](security-gaps.md) are resolved,
Timeline must not be sold or described as approved for intentionally submitting
special-category, HIPAA-regulated, or similarly restricted data without a
specific written agreement and deployment review.

## 4. Data minimization and allowed purposes

Collect, retain, and disclose only what a feature needs. Every new field,
outbound request, event property, log, or copied source requires a named purpose
and owner.

Allowed purposes are:

- provide requested capture, search, retrieval, transcription, extraction,
  summarization, notification, integration, export, and collaboration features;
- authenticate users, maintain permissions, record legal acceptance, prevent
  abuse, and secure the service;
- diagnose reliability or security problems with minimized telemetry;
- respond to user-requested support and lawful obligations; and
- measure product operation using the approved content-free analytics contract.

Customer content must not be used for advertising, sold as data, used to build
customer profiles unrelated to Timeline, used to train or fine-tune any
Timeline or third-party model, or assembled into a model-training dataset.
Product improvement may use content-free aggregate metrics, synthetic data, or
public data whose license permits that use; real customer content is excluded.

Connections are opt-in and resource-scoped. Connecting an account does not
authorize importing every resource. Disconnecting stops future access where the
provider permits it, but it does not by itself prove deletion of copies already
captured into Timeline.

## 5. Human access to hosted customer data

Timeline personnel do not routinely browse customer workspaces. Production
access is exceptional and minimum-necessary.

Permitted reasons are:

1. support requested or authorized by the customer;
2. investigation or containment of a reliability or security incident;
3. fulfillment of a documented legal or data-subject obligation; or
4. a documented operational task that cannot be completed using aggregate,
   synthetic, or redacted data.

Before accessing customer content, an operator must record the ticket or
incident, purpose, target team/data, approving person, access method, and
expected duration. Customer authorization is required for ordinary support.
Emergency break-glass access may precede approval only to contain an active
incident; it must be reviewed by the control owner on the next business day.

Production access must use a named account, MFA where available, least
privilege, and time-bounded credentials. Shared accounts are prohibited. Direct
database, object-store, provider-dashboard, backup, and log access must be
logged and reviewed. Access must be removed when a role changes or the task
ends, and the authorized-access list must be reviewed quarterly.

Personnel and contractors must not:

- inspect a workspace from curiosity, for product discovery, or to monitor a
  customer's business;
- paste customer data into personal AI, developer, messaging, or file-sharing
  tools;
- download or retain local copies beyond the approved task;
- change item visibility to make support or debugging easier;
- use customer content to evaluate or train models without separate written
  authorization; or
- disclose content outside the named incident/support/legal participants.

Provider support access follows the same minimum-necessary principle and must be
governed by the provider contract and account controls. [The security gap register](security-gaps.md) records the
current gap in evidencing staff access, break-glass logging, and review.

Current Terms/Privacy versions and renewed-acceptance requirements are owned by `packages/shared/src/legal-versions.ts`. Historical retention approval is recorded in [the dated decision](evidence/platform-retention-decision-2026-11-03.md); it does not override later publication changes.

## 6. User, team, and agent permissions

Every data path must enforce both boundaries:

1. the authenticated actor is an active member of the requested team; and
2. the actor may see the item's `team`, `private`, or `specific_users`
   visibility.

Current repository hard rules include:

- Postgres access goes through `withTeam(db, teamId, userId)` and its named
  modules. Qdrant searches include `team_id` and the user visibility filter.
- Team administrators manage team settings and shared connections but do not
  receive a general product bypass for another user's private or restricted
  content.
- Only the visibility owner may broaden an item's visibility. Derived evidence
  and reconciliation output stay at or below their source visibility floor.
- Team exports are built for the requesting user and omit content that user
  cannot see.
- Team-shared outbound MCP keys use a synthetic actor that can retrieve only
  `team`-visible evidence. Personal and `specific_users` evidence remains
  unavailable.
- Synthetic team agents are proposal-only for Timeline state. They may create
  team-visible proposals but cannot approve them or use personal pins. Enabled
  third-party tools can still cause external side effects and must be disclosed
  before connection.

New roles, admin endpoints, exports, caches, agents, background jobs, and search
indices must demonstrate both boundaries with negative cross-team and
cross-visibility tests.

Each human user must accept the current Terms of Use and acknowledge the current
Privacy Policy before using authenticated product surfaces. Terms acceptance
and Privacy Policy acknowledgment are separate evidence; neither is consent to
optional analytics, cookies, or another optional processing purpose. The
records are database-enforced immutable evidence by user and document-version
pair, with the user snapshot used as a fast current-state check. Direct updates
and deletes are blocked while the user exists; privacy-driven deletion of the
parent account may cascade the evidence. A team owner represents that they have
authority to create and administer the team; a second mutable “team accepted”
flag is not a substitute for each user's acceptance.

A material Terms update must bump its version and require renewed acceptance. A
material Privacy Policy update must bump its version and require renewed
presentation or acknowledgment. Fresh optional consent is required only when
the purpose, provider, data contract, identity behavior, or other scope covered
by the old consent materially changes; acknowledging a notice must never be
used as that consent.

The gate applies independently at the page, human API, invitation, and Server
Action boundaries. Every module under `apps/web/src/app/actions` must use the
shared server-action wrapper; only account entry, legal acceptance, email
verification, and public support operations may run before acceptance. Do not
rely on Next.js Proxy alone for Server Action authorization. Every clickwrap
submission carries the document versions rendered in that form; the server
rejects a stale or missing version before recording evidence.

## 7. AI inference and training-data policy

Timeline-controlled hosted inference goes through the shared
`packages/shared/src/llm` layer and OpenRouter. Application and worker code must
not create a second direct model-provider path. Recall's provider-managed
meeting transcription is the deliberate exception: it stays behind the shared
meeting-bots provider boundary and is not a voice-note model route.

`packages/shared/src/llm/models.ts` is the source of truth for each exact model
pin and its privacy class. The shared privacy-policy module owns the attestation version. Each
role must be classified as one of:

- `zdr_required`: generation, structured extraction, summarization, task
  classification, multimodal extraction, and embeddings. A request must use an
  endpoint OpenRouter identifies as zero data retention or fail closed. It must
  never downgrade to weaker retention during an outage.
- `retained_no_training_exception`: the non-meeting voice-note transcription
  role may retain its quality-proven model when no ZDR candidate passes the
  documented multilingual non-inferiority gate. The exception must name the
  exact model and retention terms publicly and must not weaken any other role.

The required hosted routing policy is:

- requests that expose provider routing send `data_collection: "deny"` and
  `zdr: true` for every `zdr_required` role; privacy properties override
  caller-supplied values;
- every supported API surface explicitly disables persistent response caching;
- OpenRouter may select any eligible ZDR upstream for a `zdr_required` model;
  Timeline does not pin an infrastructure provider;
- the single production key is restricted to the exact code-owned model
  catalog and production refuses to start unless its generated attestation
  binds the current policy version, canonical model-catalog SHA-256, inference
  key SHA-256 fingerprint, and configured OpenRouter guardrail id;
- production prompt logging, input/output sharing for model improvement,
  Broadcast, and persistent response caching or presets remain disabled; and
- LangSmith prompt/output tracing is prohibited in production. Development or
  evaluation tracing uses synthetic or specifically approved data only.

ZDR and no-training are not synonyms for “no processing.” OpenRouter and the
selected endpoint process content transiently, and OpenRouter may retain limited
request, billing, abuse-prevention, and operational metadata. In-memory provider
caching may also be compatible with a provider's ZDR definition. Timeline stores
the source records and generated results needed to provide the product.

A model identifier is not a privacy control because OpenRouter can change or
add endpoints. The following OpenRouter guardrail, official-origin, and local
attestation requirements apply to Timeline-hosted production. A separately
operated self-managed deployment owns and documents its provider/proxy policy
and must not reuse Timeline-hosted provider assurances. Before changing a
hosted model, fallback, privacy class, API surface, provider key, or guardrail,
the change owner must:

1. confirm the live endpoint appears in OpenRouter's ZDR registry and does not
   permit training;
2. verify every `zdr_required` model group is covered by the production
   key/account guardrail and every catalog model is on the key allowlist. This
   is a separate management-key deployment check: record the returned guardrail
   settings and key assignment/allowlist as dated evidence, and never place the
   management key in a web or worker runtime environment;
3. run boundary tests that inspect the outbound request and a synthetic live
   canary;
4. verify prompt logging, data sharing, and response caching remain off;
5. update the provider evidence memo and this register; and
6. run quality and cost evaluations because privacy-safe routing can change
   model behavior; and
7. bump the privacy-policy version whenever the hosted model/privacy contract
   changes, regenerate `OPENROUTER_PRIVACY_POLICY_ATTESTATION` with
   `bun run openrouter:attestation`, then update deployment evidence and public
   copy from the registry.

The generated attestation is a local drift detector, not proof that OpenRouter
accepted the intended configuration. Provider-side guardrail assignment,
`allowed_models`, ZDR enforcement, logging, sharing, Broadcast, and cache
settings require the separate management-key canary/deployment check and dated
evidence. OpenRouter management credentials are operator-only and must never be
stored in application, web, worker, or document-extract runtime environments.

Dedicated voice-note transcription is separate from Recall meeting
transcription. The current code keeps `openai/gpt-4o-transcribe` as the
`retained_no_training_exception` quality baseline. OpenRouter currently lists
OpenAI as not training on prompts but retaining them; OpenAI documents default
API abuse-monitoring retention of up to 30 days. This is not ZDR and must never
be described as such.

A ZDR transcription candidate may replace that baseline only after a
reproducible, non-customer bake-off covers at least 24 representative languages,
every accepted audio format, accents, background noise, silence, names,
numbers, long low-bitrate recordings, and code-switching. It passes only when:

- macro WER/CER is within 0.5 absolute points of the baseline;
- no language or source slice regresses by more than 2 absolute points;
- entity and number accuracy remains within 1 point;
- hallucination, empty-output, truncation, and format-error rates do not
  increase; and
- p95 latency remains within 15% of baseline and inside the existing request
  budget.

Among passing candidates, choose the lowest error rate, then entity accuracy,
coverage, latency, availability, and finally cost. The live evaluation stores
only aggregate quality, latency, route, and cost metrics—never audio or
transcript content. Until a candidate passes and its evidence artifact is
locked, changing the production transcription pin is prohibited.

## 8. Infrastructure and storage

The documented hosted topology runs the web app, workers, document-extraction
orchestrator, PostgreSQL, Redis, Qdrant, and RustFS on Railway. PostgreSQL and
Redis are Railway templates, but Railway describes those databases as
unmanaged: Timeline remains responsible for configuration, backup, restore,
hardening, and monitoring. Qdrant and RustFS are self-hosted software on Railway
services and volumes, not Qdrant Cloud or RustFS Cloud subprocessors.

| Store | Data | Required boundary |
| --- | --- | --- |
| PostgreSQL | Accounts, membership, customer records, content, permissions, job state, audit data | Team-scoped queries, least-privileged credentials, migration review, backup/restore control |
| Redis/BullMQ | Rate limits, caches, queues, transient job payloads | Minimized payloads, bounded lifetime, no unnecessary source content, private network |
| Qdrant | Embeddings and visibility metadata | `team_id` plus visibility filters and derived-data deletion; application traffic uses private networking, while an API-key-protected public operator endpoint remains |
| RustFS | Voice notes, attachments, documents, and exports | Non-public buckets, team-authorized short-lived signed URLs, scoped object keys, deletion and backup controls |

Internal service traffic should use Railway private networking. Public exposure
must be limited to the web entry point, necessary verified webhooks, and the
RustFS endpoint needed to serve short-lived signed browser transfers. A public
object endpoint does not make a bucket public.

Integration and MCP OAuth/bearer secrets are encrypted at rest with AES-256-GCM
through the shared secrets helper. Hash one-time bearer credentials where the
caller never needs plaintext again. Do not describe ordinary PostgreSQL rows,
vectors, or RustFS object bytes as application-encrypted unless a verified
control actually provides that property. Transport encryption and provider
volume encryption are separate claims and require deployment evidence.

Production and staging must use separate databases, queues, vector stores,
object stores, encryption keys, provider credentials, and analytics projects.
Production data must not be copied to local, test, demo, or staging environments
without a documented, approved, minimized, and time-bounded process.

Regions, backup schedules, storage encryption, public networking, log retention,
and restore tests are deployment facts that the repository does not prove. They
remain open until the evidence pack in the [security gap register](security-gaps.md) is complete.

## 9. Files, documents, voice notes, and meetings

Uploaded objects use purpose-specific RustFS buckets and team-derived object
keys. Browser uploads and downloads use short-lived signed URLs only after the
application authorizes the team, user, object, and visibility. File type and
size checks are defense in depth; file contents remain untrusted.

Supported complex documents may be processed in a fresh Daytona sandbox. The
current design sends document bytes but no application credentials, blocks
outbound sandbox networking, uses ephemeral storage, auto-stops the sandbox,
and deletes it in cleanup. Daytona may retain observability data for three days,
and its standard DPA does not currently establish coverage for unrestricted
special-category data. Do not call the path “zero retention.”

Meeting capture is silent and consent-gated. The scheduler requires the host to
confirm that participants will be informed. Recall.ai joins the call, processes
audio/video, and produces transcript events. Production with
`TIMELINE_DEPLOYMENT_MODE=hosted` requests a one-hour timed-retention setting
because the accuracy-oriented transcription mode is incompatible with Recall's
zero-retention option. The mode defaults to `hosted` so the restriction fails
closed. A separately licensed and operated deployment may explicitly use
`self-managed` and becomes responsible for its retention choice and notice.
Recall documents that window as starting when recording
status reaches `done`; deployed deletion remains unverified. Timeline does not
copy raw meeting audio/video into RustFS; it persists the transcript and derived
meeting records under workspace visibility.

Timeline keeps only Recall's bot identifier from a successful Create Bot
response. Non-success response bodies are discarded rather than attached to
errors, logs, or meeting metadata; persisted join failures contain only a
content-free status/category, and the migration removes legacy raw response and
error fields. Hosted production accepts only Recall's documented HTTPS regional
API hosts and pins realtime transcripts to the exact callback path on the
configured application origin. Signed status and transcript webhooks resolve a
Recall bot before constructing the team scope, and the lookup fails closed if an
unexpected duplicate bot identifier exists across teams. Cancellation first
writes an atomic transcript-closed timestamp that blocks buffered and late
persistence while any existing partial transcript finishes processing. It is
reported as successful only after Recall confirms the bot leave command; failed
confirmations remain durable for the meeting scheduler to retry.

Uploaded voice notes are different from meeting recordings: Timeline stores the
voice-note object in RustFS so the capture can be processed and used as workspace
evidence. Public copy must keep this distinction clear.

## 10. Analytics, cookies, logging, and monitoring

[The analytics contract](privacy-analytics-interface.md) owns the exact route, consent, identity and payload rules. Preserve its separation of personless fixed streams, optional public-browser analytics, pseudonymous server/worker product events, and independent minimized reliability monitoring. Private workspace routes must not load browser analytics or join identities to public visitors.

Optional browser access requires an affirmative, withdrawable choice; legal acceptance is not that consent. New data purposes, fields, providers or identities require review and, where applicable, renewed consent. A telemetry SDK update must not silently add payload fields. Do not export content, secrets, arbitrary URLs, raw actor IDs, headers or error objects through analytics.

Reliability monitoring is not permission for replay, model training, advertising or content collection. Keep default PII/replay and production prompt/output tracing disabled, scrub secrets and sensitive URL parameters at transport boundaries, and retain only necessary diagnostic metadata. Server/provider access logs are separate flows requiring their own retention and access evidence.

[Setup](setup/analytics.md) owns configuration and [the provider register](providers.md) owns dated account observations. G-03, G-10 and G-11 in [security gaps](security-gaps.md) track outstanding legacy data, analytics and monitoring evidence. Removing source code or requesting deletion does not establish deployment or completed erasure.


## Providers

See [the provider register](providers.md) for services and [security gaps](security-gaps.md) for unresolved verification.

## 12. Retention, deletion, export, and rights

Team owners can authorize team-wide deletion, including members’ private content within that team, through a request that immediately disables access. Platform admins control restoration before irreversible deletion and perform the tracked cleanup. This authority does not grant owners visibility into other members’ private content or exports. Disabling preserves data; permanent cleanup removes operational content while retaining only the tombstone and explicitly justified financial/security evidence. Personal credentials are removed when unused elsewhere; other teams, accounts and original provider files remain. [Platform administration](platform-admin.md#team-deletion-lifecycle) owns the workflow and deployment requirements. Backup/provider completion remains evidence-dependent and separately tracked.


Retention follows purpose and must be stated per system. “Deleted” means all
named active stores and processors have completed their defined deletion path;
a soft-delete flag alone is not a complete deletion claim.

| Data/system | Current known handling | Publicly safe statement |
| --- | --- | --- |
| Timeline account and workspace records | Stored in active systems until user/team action, contract need, or legal obligation; no complete hosted schedule is yet evidenced | Do not promise a deletion SLA |
| PostgreSQL backups and Railway volumes | Configuration is deployment-specific and unverified | Say backup retention is being documented, not that deletion is immediate |
| Qdrant vectors | Derived points are team-scoped and many deletion paths remove them; full propagation test remains open | Do not claim every vector is deleted immediately |
| RustFS files and exports | Active objects have application deletion helpers and signed access; backup/version deletion is not yet end-to-end verified | Distinguish active object deletion from backup expiry |
| Redis and BullMQ | Cache/job lifetimes vary by queue and configuration | Do not use Redis as a durable content archive; document each content-bearing queue |
| OpenRouter ZDR-required endpoints | ZDR routes process content without endpoint persistence; OpenRouter may retain non-content operational metadata | Qualify content versus metadata and do not imply a fixed upstream |
| OpenRouter voice transcription | Current `openai/gpt-4o-transcribe` quality exception is non-training but prompt-retaining; OpenAI documents default API abuse-monitoring retention up to 30 days | Name the exception and retention; never call hosted AI universally ZDR |
| Recall.ai | Timeline-hosted mode requests one-hour meeting-media retention, which Recall documents as starting at recording `done`; an explicit self-managed deployment can choose another supported duration. Operational logs can remain seven days and meeting URLs fourteen days after termination; Timeline transcript persists | Never say call media is deleted or provider deletion is verified until deployed evidence exists |
| Daytona | Ephemeral sandbox state is discarded/deleted; observability data may remain three days | Never equate ephemeral compute with zero provider retention |
| Firecrawl | Firecrawl documents US processing and a 24-hour crawl-result API window. Privacy policy PII retention is until written deletion, with no recurring deletion schedule. Enterprise zero-data-retention is not enabled. | Cite the published 24-hour API window and US location. Say broader page-content retention is to be confirmed. Never claim zero-data retention. |
| Resend | Domain `in.thetimeline.cc` sends from `eu-west-1`; inbound receiving enabled; open/click tracking currently enabled at domain level (no per-send flags in code). Resend states US storage regardless of sending region and 30-day email/log retention on Free/Pro/Scale while active, deletion within 90 days after termination. Timeline deletion does not itself delete Resend copies. | Cite Resend's published statements. Do not claim Timeline's plan name, a signed DPA on file, custom retention, API key scope, or that tracking is off |
| PostHog | Current source enforces zero browser capture/identifier before valid consent or after rejection, public-route-only browser analytics after opt-in, fixed personless surface streams, and explicit minimized server/worker events. The EU account review verifies disabled automatic capture and IP discard. Pay-as-you-go documents seven-year product-event retention, which exceeds the 90-day target; production and deletion completion remain unverified. | Public copy may describe the source-enforced product design and the dated account review. Do not claim that it is deployed, that retention is 90 days, that queued deletion is complete, or that pseudonymous analytics is anonymous until G-10 closes. |
| Sentry | Account retention is unverified | Describe minimized error monitoring, not a retention period |
| LangSmith | Production tracing is rejected | Development traces must use synthetic/approved data and follow the selected account retention |
| Connected services | Source retention remains controlled by the customer's provider; Timeline retains captured copies separately | Disconnecting is not deletion from either system |
| Google Drive v1 snapshots | Truncated text snapshots (retention 3 per file) plus full-text content hashes, comments, permission hashes, and compact permission-grant identities (id/type/role/email/domain beside the locate index) so `client_share` emits only newly introduced anyone/external grants; native Google Sheets snapshot every tab (including hidden) via Sheets API `spreadsheets.get` / `values.batchGet` under existing `drive.readonly` because Drive `files.export` `text/csv` is first-sheet-only, then hash that workbook text on the free path rather than Daytona xlsx extract; native Google Docs snapshot every tab (including nested child tabs) via Docs API `documents.get?includeTabsContent=true` under existing `drive.readonly` because Drive `files.export` `text/plain` is not documented as covering the Docs tabs feature and Docs API without that flag is first-tab-only, then hash that document text (person smart chips name/email, rich/resource links, and ordinary textStyle.link destinations, not only plain textRun content; `suggestionsViewMode=PREVIEW_WITHOUT_SUGGESTIONS` so pending suggested inserts are not hashed as committed) on the free path rather than Daytona docx extract; artifact rebind parenthesizes provider/alias matches inside the team filter; a revisited retained fingerprint refreshes its ordering timestamp so it is the latest baseline again; judged events include the Drive revision in the dedup key so returning to an earlier body is a new occurrence; diffs compare the stored 20k prefix, suffix window, and full-document chunk index (hashes; only the latest retained state stores per-chunk extracted text to detect later edits, older states keep hashes only, and that latest extracted text is deleted on disconnect or file removal — not a document-drive copy) against the current full text, inspect every chunk that touches the unstored middle (including prefix/suffix straddlers), char-diff stored previous chunk text so hunks are centered on every distinct changed span rather than one truncated first-to-last bounding span, abort span collection once more than 20 spans are found (refusing persist rather than dropping a span) and bound each resync scan to an 8k window, never classify a moved full-text hash as identical, and refuse to advance the text baseline unless every distinct span is represented in those hunks and in the packed event (and judge input when the judge runs), including strong-signal comments; a long comment-plus-hunk change splits across events or defers persist rather than dropping later passages; snapshots also store a compact comments list (full compacted comment and reply bodies for hashing and change detection; packed event context preview-truncates only unchanged comments/replies) so bounded event context can rank every `commentsHash` field change first, including reopen, `modifiedTime`, and reply bodies fetched via `replies[]` with new or changed replies first (the comment fingerprint advances only when every changed reply is packed; deletions omitted by `comments.list` are recovered from previous snapshot ids); membership walks past unlinked selected folders and still walks ancestors of an explicitly selected file so live capture can inherit from the nearest linked ancestor; capture-time evidence writes rebind that file's anchors onto the live resolver object before reconcile; replacing a Drive selection object link rebinds each affected file onto the most-specific remaining selected ancestor (file, then folder, then shared drive; a selected folder beats a shared drive even when the drive is listed first) in one transaction with the selection-row update; removing a folder or shared drive deletes snapshots and cancels extract for files that remaining selections no longer cover, including baseline-only files whose walked ancestry is stamped on the snapshot; unchanged-content recaptures persist that live walk so a move from folder A to B is not lost; coverage and cleanup read the newest tracked ancestry (snapshot or event), not event hints alone; equal-length one-letter substitutions such as hiring→firing stay substantive rather than tiny typos; markdown link destinations stay in the normalized compare so a same-title URI retarget is judged rather than skipped as formatting; assigning a previously unlinked folder or shared drive rebinds files whose ancestry includes that selection, including files already on an outer folder or shared-drive object, then applies live-capture before/after precedence; captured Drive events stamp the winning selection and candidate walk; dropping a file selection that remaining folders or shared drives still cover keeps snapshots/extract and rebinds the file onto the surviving inherited object link; uncovered drops, including last-container leftover extracts, delete snapshots and keep a cancellation tombstone until the producer wait window settles; disconnect persists those cancel tombstones before deleting the integration and fails closed until the wait settles so a late result.json is not orphaned after DeleteObject 404s a not-yet-written key; share revoke, activate-source narrowing, last-selection incrementalSync, and disconnect use that same coverage-aware cleanup rather than deleting selection rows alone; transient S3 timeouts and 5xx reads of a valid extract result or the source blob retry without writing a failed extract, resuming capture, deleting the blob, or consuming the paid extract slot; the changes feed deletes snapshots and cancels extract for removed/out-of-scope/unsupported-mime files before the cursor advances; disconnect S3 cleanup forwards extract tombstones; extract replacements keep prior extract-id tombstones until producer-finished or TTL even when S3 delete reported success; unpublished extract jobs retry immediately; full Drive copies are not stored in the document drive; PDF/Word/Slides bytes are extracted transiently by `document-extract-orchestrator` and deleted after the `drive.file` resume is accepted, when the file is missing/out of scope/removed/unsupported-mime/unselected/disconnected, or by a 24-hour janitor sweep that enumerates teams then deletes through `withTeam(...).integrations` if resume never runs; a failed S3 delete keeps a `cleanupPending` cursor until both objects are gone; cancel/out-of-scope/stale-revision cleanup keeps that tombstone until the extract wait window elapses so a late `result.json` is not orphaned; leftover `{}` extract cursors are excluded in SQL before the page limit, and disconnect paginates S3 cleanup; ready extract JSON is consumed only after the event and snapshot are saved and is capped at 2 MiB at write and read; extract cursors are team-scoped and stamp the Drive revision of uploaded bytes | Say selected-source capture, latest extracted text kept only to detect changes then deleted on disconnect or file removal, not a Drive document archive |

Each deletion or data-subject request must have a case owner and cover, as
applicable: account rows, memberships, raw and derived records, object bytes,
vectors, queues/caches, exports, backups, analytics, error traces, email,
meeting-provider data, and other subprocessors. Preserve only records required by
law, security, fraud prevention, or contract, and record the purpose and expiry.

Team exports must preserve the requesting user's visibility and use short-lived
download access. Export generation and signed-file counts are auditable; export
archives require expiry and cleanup.

The [manual support deletion runbook](./setup/manual-support-deletion.md) defines
intake, authority checks, inventory, coordinated source shutdown, case-specific
removal, verification, and customer follow-up. This is a manual service process,
not an automated purge system or evidence of a successful deletion rehearsal.
Personal connection removal deletes credentials and disables dependent sources;
team-source disconnect handles snapshots and extracts. Neither erases captured
history. Missing scoped removal operations require engineering escalation, not
unscoped production SQL. G-13 remains open until the relevant stores and provider
propagation are exercised. Legal copy must not promise an unverified duration.

Material disclosure changes require current-version acceptance/acknowledgment under the source-owned legal gate. They do not close provider-account gaps.

## 13. Incident response

A suspected exposure, cross-team access, secret leak, unauthorized provider
flow, lost device, malicious integration, or unexplained access log is a security
incident until triaged.

1. **Receive and preserve.** Open a private incident record, preserve relevant
   logs and timestamps, and avoid copying customer content into the ticket.
2. **Contain.** Disable the path, revoke tokens, rotate credentials, stop jobs,
   isolate affected services, or temporarily remove a provider as needed.
3. **Assess.** Identify affected teams, people, data classes, visibility,
   providers, regions, duration, and whether data was accessed, changed,
   exfiltrated, or merely exposed.
4. **Escalate.** Assign incident lead, technical lead, privacy/legal owner, and
   communications owner. Contact insurers, providers, or authorities when the
   applicable plan requires it.
5. **Notify.** Meet contractual and legal notice periods. Communicate known
   facts, customer actions, and uncertainty; never wait for perfect certainty
   when a deadline applies.
6. **Recover.** Patch the root cause, validate isolation and data integrity,
   restore safely, and monitor for recurrence.
7. **Learn.** Complete a blameless post-incident review with corrective owners,
   deadlines, tests, and updates to this document and public statements.

The control owner decides severity using impact, scope, exploitability, data
class, and active abuse. Any confirmed cross-team disclosure, secret disclosure,
or public exploit is high severity regardless of row count.

## 14. Vulnerability reporting and handling

Public reporting instructions live in [SECURITY.md](../SECURITY.md). Security
reports must remain private until a coordinated disclosure is agreed.

On receipt, the security owner must:

- acknowledge and create a private record;
- reproduce with synthetic or reporter-owned data;
- classify affected versions/surfaces, impact, and exploitability;
- contain active risk before ordinary release scheduling;
- keep the reporter updated and coordinate disclosure timing;
- add a regression test and review adjacent paths, not only the reported line;
  and
- credit the reporter if requested and safe.

There is no implied bug bounty. Good-faith testing within the safe-harbor limits
in `SECURITY.md` should not be treated as abuse.

## 15. Secure-development hard rules

Every change must preserve these rules:

- Team isolation and item visibility are enforced in data access, vectors,
  caches, exports, background jobs, and agent tools.
- Source-ingested raw event content remains immutable; corrections are derived
  and auditable.
- All Timeline-controlled AI requests use the shared inference layer and the
  fail-closed privacy routing in section 7. Recall meeting transcription stays
  exclusively behind the meeting-bots provider boundary described there.
- Production tracing of prompts or outputs remains disabled.
- Credentials use the shared secret-encryption or one-way hashing path; no
  plaintext secret persistence.
- External MCP/integration content is fenced as untrusted, and untrusted URLs
  pass the SSRF guard before network access.
- Webhooks authenticate signatures or strong shared secrets before processing;
  logs never expose webhook URLs or tokens.
- Analytics and logs follow section 10 and the privacy/analytics interface:
  personless surface streams use fixed non-visitor IDs and allowlisted enums,
  optional browser analytics is consent-gated and public-route-only, private
  routes load no browser analytics, and authenticated events are explicit
  pseudonymous server/worker calls.
- Files are untrusted, size-bounded, type-checked, and accessed through
  authorized short-lived URLs.
- New providers and outbound domains complete the provider review in the [provider register](providers.md)
  before production use.
- Data deletion covers derivatives and failed/partial artifacts, not only the
  primary row.
- Legal-version changes update public copy, append-only acceptance or
  acknowledgment evidence, and tests together. Terms reacceptance, Privacy
  Policy reacknowledgment, and fresh optional consent are separate gates.
- Run focused privacy regression tests for changed behavior and follow the
  [validation and merge policy](testing/README.md#validation-policy). Required GitHub
  checks must pass before merging; an open PR is not a verified release.

Test with at least two teams and multiple users. Include negative cases for
inactive membership, private items, specific-user items, synthetic agents,
stale sessions, guessed identifiers, async stale responses, failed cleanup, and
provider downgrade or outage. A test that only proves the happy path is not a
privacy test.

## 16. Public claims and assurance status

Public claims must be specific, time-bounded where needed, and tied to evidence.

### Allowed with the stated qualification

- The repository source is publicly inspectable and non-sensitive issues are
  welcome. Until contribution terms and a license are published, contributors
  must contact Timeline before submitting a pull request. Public source
  improves transparency but is not an independent security audit.
- Repository controls and deployment policy require no-collection, ZDR
  endpoints, cache disablement, and fail-closed routing for every
  `zdr_required` role. This may be described as a hosted-product guarantee only
  after the current production key, account settings, and recurring canary
  evidence are captured. OpenRouter and endpoints still process content
  transiently and may retain operational metadata.
- Non-meeting voice transcription may be described as the explicit
  `openai/gpt-4o-transcribe` no-training quality exception, including
  OpenRouter's prompt-retaining classification and OpenAI's documented default
  API abuse-monitoring retention of up to 30 days. Do not imply that exception
  is ZDR.
- Qdrant and RustFS run as self-hosted software in the documented Railway
  topology.
- Integration and MCP credentials use AES-256-GCM at rest in Timeline.
- Team admins do not receive a general product bypass for private or
  specific-user items.
- Timeline does not copy Recall meeting audio/video into Timeline storage;
  production with `TIMELINE_DEPLOYMENT_MODE=hosted` requests Recall's one-hour
  media-retention setting and Timeline keeps the transcript. Completed provider
  deletion remains unverified until G-07 is closed.
- A separately licensed customer-controlled deployment can move infrastructure
  and staff-access decisions into the customer's boundary.

### Prohibited until the named gap is closed

- “Fully private,” “your data never leaves Timeline,” or “no third party sees
  data.”
- “No one can train on or retain your data,” “all hosted AI is ZDR,” or another
  blanket claim that hides the voice-transcription exception. A no-training
  claim must still be scoped to the evidenced model/provider policies and
  Timeline's own enforceable conduct.
- “Meeting recordings are never stored” or “deleted instantly.”
- “All data stays in the EU” without service, volume, backup, support, analytics,
  and provider-region evidence.
- “End-to-end encrypted,” “all files are encrypted by Timeline,” or “zero
  knowledge.”
- “Railway-managed databases”; the database templates are unmanaged.
- A deletion duration not proven across active stores, backups, vectors, queues,
  and providers.
- “No browser tracking,” “rejecting creates no identifier,” or “private routes
  never load analytics” as a deployed fact until G-10's provider-account and
  deployment evidence is complete.
- “Anonymous analytics” when stable user or team identifiers are processed.
- “Open source” or “anyone may self-host” until a repository license grants those
  rights.
- Any claim that Timeline is SOC 2 audited, ISO 27001 certified, HIPAA compliant,
  or “GDPR certified.”

Nyxone OÜ / Timeline currently has no SOC 2 report, ISO 27001 certificate, or
HIPAA program/BAA coverage evidenced in this repository. GDPR is a legal
framework, not a certification badge. A provider's certificate belongs to that
provider and must not be displayed as Timeline's own assurance. Future badges
may be published only with the correct legal entity, scope, system, auditor,
period, and current evidence.

## Open evidence

See [the security gap register](security-gaps.md).

## 18. Change and review process

Review this standard:

- in every change that adds or changes a model, provider, SDK, outbound domain,
  data category, permission, visibility rule, human-access path, log, analytics
  event, cookie, storage system, retention/deletion path, export, or legal/trust
  statement;
- quarterly against current code, production configuration, provider policies,
  endpoint registries, contracts, subprocessors, access lists, and gap evidence;
- after every security/privacy incident or material provider change; and
- before an enterprise security answer, regulated-data commitment, or assurance
  badge is published.

The change owner must update the relevant sections, provider table, gap status,
version, and last-evidence date in the same pull request. If current evidence is
not available, leave the gap open and weaken the public claim.

A material Terms change must update its version and effective date and trigger
per-user reacceptance. A material Privacy Policy change must update its version
and effective date and trigger renewed presentation or acknowledgment; that is
not optional-processing consent. A material change to a consented purpose,
provider, data contract, identity behavior, or other covered scope must
invalidate the old consent and request a new affirmative choice. Editorial
clarifications may keep a version only after counsel or the legal owner records
why the change is not material.

Before release, compare every statement in the Trust page, Privacy Policy,
Cookies and similar technologies notice, Terms, help, guides, README, sales
material, and security questionnaires against section 16 and the open-gap
table. Completion means every modified claim has current support or has been
removed.

Deferred Slack/Telegram command delivery stores an AES-256-GCM encrypted payload in the existing Redis queue infrastructure, including the credential needed to complete that authorized send. Successful jobs are removed immediately; failed jobs expire after 24 hours. Pending quota-delayed sends remain until eligible. Delivery logs contain job IDs, never message contents or credentials. Agent answers retain their existing conversation-turn delivery path.

## Password recovery

Password recovery stores SHA-256 digests of random 32-byte, single-use tokens,
with a 30-minute expiry, separately from email-verification tokens. Issuance and
redemption serialize on the account row. Redemption atomically replaces the
password hash, deletes reset tokens, and increments the login session version.
Proxy and server Auth.js checks compare JWT versions against the database on use;
legacy JWTs are version zero. Existing login sessions are invalidated on their
next request; already-running requests and integration/MCP credentials are not
revoked by this flow. Recovery does not change verification or legal acceptance.

Request responses do not disclose whether an email has a password account. Redis
rate limits apply before account lookup and fail closed when Redis is unavailable.
Reset email retry payloads use the existing AES-256-GCM encrypted delivery format;
Resend receives the reset URL to deliver the email. Recovery routes have no browser
analytics, no-index/no-store/no-referrer policies, and sanitized error events.
Open/click tracking is disclosed as currently enabled. Signed DPA on file, custom
retention, API key scope, and support access remain G-09; this feature makes no
new claim for those items. Infrastructure access logs must not retain reset
URL query parameters. Production delivery still requires operator verification.

## Agent coworker authority and retention

See [agent coworkers](agent-coworkers.md) for the implemented authority boundaries. Dedicated hashed provisioning credentials cannot authenticate MCP or ingest. Only verified existing owners with current legal acceptance and an active owner membership can provision new workspaces; soft-removed owner rows do not qualify. No existing-team access, paid-plan activation or agent:ask is granted. Transactional encrypted response receipts expire after fifteen minutes; retained hashes prevent duplicate provisioning. Janitor clears expired ciphertext and auth continuations. Reporting preferences authorize behavior within existing capture scopes and do not confer canonical-record approval or unrelated external authority. No credentials or note bodies belong in monitoring events.

Consent reporting edits are restricted to current owners/admins and committed atomically with the OAuth grant, authorization code and reporting audit. Member consent exposes only that member/client’s preference. Raw project scope is excluded from redirect parameters and issuance exception telemetry. Inherited or retained ongoing settings never expand capture permission.

## Email and source recovery

Signed email webhooks queue provider IDs; workers admit senders before downloading bounded content/attachments. Recovery requires the scoped internal ingest principal and fails closed for restricted parents. Retry payloads are encrypted; temporary URLs and credentials do not enter source snapshots. Provider delivery/retention evidence remains in the provider register.

Disconnect, source removal and erasure are separate operations. Follow [manual support deletion](setup/manual-support-deletion.md); disclose retained history, backups, legal/billing records and processor copies without promising unverified completion.

Sentry intake and queued delivery require current source selection. GitHub capture requires the matching installation token and fails closed on missing mappings. Health/readiness responses expose aggregate operational state, not content or secrets.
