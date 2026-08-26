# Security, privacy, and trust operating standard

| Field | Value |
| --- | --- |
| Status | Normative internal standard |
| Applies to | Hosted Timeline, public Timeline surfaces, development, support, and vendor operations |
| Service operator | Nyxone OÜ, Estonian registry code 16172329 |
| Control owner | **TBD: named security/privacy owner** |
| Version | 2026-08-21 |
| Last evidence review | 2026-08-21 |
| Next scheduled review | **TBD: no later than 2026-11-21** |
| Evidence memo | [Provider privacy and data-handling research](./research/provider-privacy-audit-2026-08-21.md) |
| Legal research | [GDPR, cookies, and consent audit](./research/gdpr-cookie-consent-audit-2026-08-21.md) |
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
  automatically remove OpenRouter, Recall.ai, Postmark, Daytona, or connected
  services.

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

Until the Railway and Daytona contractual gaps in section 17 are resolved,
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
governed by the provider contract and account controls. Section 17 records the
current gap in evidencing staff access, break-glass logging, and review.

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

All hosted inference goes through the shared `packages/shared/src/llm` layer and
OpenRouter. Application and worker code must not create a second inference path
or call a model provider directly.

The required hosted routing policy is:

- every chat, structured, summarization, vision, embedding, and transcription
  request uses a model endpoint that OpenRouter identifies as zero data
  retention;
- requests that expose provider routing send `data_collection: "deny"` and
  `zdr: true`; privacy properties override caller-supplied values;
- a request fails when no compliant endpoint is available; availability must not
  silently weaken privacy;
- production refuses to start with an OpenRouter key unless an operator has
  confirmed that the key or account is bound to the required ZDR guardrail;
- production prompt logging, input/output sharing for model improvement, and
  response caching or presets that store content must remain disabled; and
- LangSmith prompt/output tracing is prohibited in production. Development or
  evaluation tracing uses synthetic or specifically approved data only.

ZDR and no-training are not synonyms for “no processing.” OpenRouter and the
selected endpoint process content transiently, and OpenRouter may retain limited
request, billing, abuse-prevention, and operational metadata. In-memory provider
caching may also be compatible with a provider's ZDR definition. Timeline stores
the source records and generated results needed to provide the product.

A model identifier is not a privacy control because OpenRouter can change or
add endpoints. Before changing a model, fallback, API surface, provider key, or
guardrail, the change owner must:

1. confirm the live endpoint appears in OpenRouter's ZDR registry and does not
   permit training;
2. verify every relevant model group is covered by the production key/account
   guardrail;
3. run boundary tests that inspect the outbound request and a synthetic live
   canary;
4. verify prompt logging, data sharing, and response caching remain off;
5. update the provider evidence memo and this register; and
6. run quality and cost evaluations because privacy-safe routing can change
   model behavior.

The current code pins `openai/whisper-large-v3` for dedicated transcription
because its endpoints were present in the live ZDR registry on 2026-08-21. That
is dated evidence, not a permanent property; quarterly drift checks remain
required.

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
| Qdrant | Embeddings and visibility metadata | `team_id` plus visibility filters, derived-data deletion, no public endpoint |
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
remain open until the evidence pack in section 17 is complete.

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
audio/video, and produces transcript events. The hosted default retains Recall
meeting media for one hour because the accuracy-oriented transcription mode is
incompatible with Recall's zero-retention option. Timeline does not copy raw
meeting audio/video into RustFS; it persists the transcript and derived meeting
records under workspace visibility.

Uploaded voice notes are different from meeting recordings: Timeline stores the
voice-note object in RustFS so the capture can be processed and used as workspace
evidence. Public copy must keep this distinction clear.

## 10. Analytics, cookies, logging, and monitoring

The normative contract is defined in the
[privacy and analytics implementation interface](./privacy-analytics-interface.md).
The current source implements that runtime boundary with focused tests. The
[2026-08-26 PostHog account review](./research/posthog-rollout-evidence-2026-08-26.md)
verifies part of the provider configuration, but it is not production evidence.
G-03 and G-10 remain partial until the specified deployment, contract,
retention, deletion, and canary evidence is retained.

The current source has four analytics paths and one separate reliability path:

1. **Personless public and app surface-request streams are always on.** They run
   server-side on allowlisted route templates and use one fixed, non-visitor
   PostHog stream ID for public requests and another for authenticated app
   requests. The only variable property is an allowlisted surface enum. They do
   not read browser consent or include a visitor, user, team, device, session,
   cookie, client-request IP, user-agent, referrer, campaign, URL parameter, or
   Customer Content value. PostHog receives only the server connection and
   reviewed SDK transport metadata (project key, stream ID, event name, SDK
   server marker, SDK name/version, UUID/timestamps, and GeoIP-disable flag); GeoIP enrichment is
   disabled. None of those fields is derived from the request. These events support totals only, not unique
   visitors, sessions, retention, or returning-user analysis.
2. **Public browser analytics is optional.** It may run only after affirmative
   analytics consent and only on allowlisted public routes. Before a choice,
   after rejection, and after withdrawal there must be zero browser PostHog
   capture, request, identifier, or storage.
3. **Private workspace routes never load browser analytics.** They do not
   import, initialize, identify, capture, forward browser events, or request
   analytics-backed feature flags. Prior consent on a public route does not
   weaken the private boundary or link the public identity to an account.
4. **Authenticated product analytics is explicit server/worker processing.**
   Each event has a named purpose, owner, exact runtime-validated schema, and
   legal basis. It is content-free and requires a validated user or team actor
   whose raw ID is HMAC-pseudonymized before capture. Browser consent does not
   authorize this separate path or connect that actor to a public identity.
5. **Sentry is separate reliability/security monitoring.** It does not share a
   PostHog identity or turn analytics consent into error-monitoring consent. Its
   minimization, scrubber, provider, retention, and legal-basis controls remain
   independently subject to G-11.

Declining optional browser analytics does not affect the personless server
surface streams and must not affect public content, signup, authentication,
invitations, or authenticated product features. The consent interface must
explain this distinction and provide equally clear accept and reject actions,
an easy withdrawal control, and a minimal necessary record that remembers the
choice.

The Privacy Policy and Cookies and similar technologies notice explain the
processing; showing, linking, accepting, or acknowledging them is not optional
analytics consent. Terms acceptance is also separate.

PostHog autocapture, automatic pageview/pageleave capture, heatmaps, session
recording/replay, DOM capture, and client-side feature-flag analytics are
prohibited. A consented public event must be manual, named, source-allowlisted,
and content-free. Names, emails, raw URLs, queries, filenames, form values,
prompts, outputs, transcripts, documents, cookies, headers, arbitrary errors,
and uploaded or customer content are prohibited. Public PostHog identities must
never be identified, aliased, or grouped to an account, user, or team.

The legacy Convex pageview import is removed from the current source and guarded
by a regression test. Deployed behavior, logs, token URLs, retained data,
deletion, and credential rotation remain an analytics/security handoff under
G-03. This standard does not infer deployment state from a worktree removal.

The public and authenticated product may use strictly necessary cookies or
browser storage for authentication, active-team and invite state, security,
sidebar or tutorial preferences, and short-lived handoff state. Cloudflare
Turnstile is conditional anti-abuse processing on signup and support forms. Do
not label all storage as “cookies” or all cookies as analytics; document purpose,
lifetime, and provider accurately.

Sentry is conditional error monitoring. The current source keeps default PII
collection and session replay disabled, removes request cookies and all request
headers from events and transactions, sanitizes request URLs and breadcrumbs,
and minimizes production trace/profile sampling. Exception text can still
contain unexpected customer data, so deployed configuration, sample events,
and scrubbers require review before an **Enforced** or **Verified** claim.

Application logs must not include customer-content bodies, prompts, outputs,
transcripts, document text, authorization/cookie headers, signed URLs, tokens,
or encryption material. Log identifiers, operation, status, duration, counts,
and a redacted error category. Debug logging must not weaken the production
rule.

## 11. Providers and customer-directed services

A fixed subprocessor is a provider Timeline selects to operate the hosted
service. A customer-directed service is connected or invoked by the customer.
Maintain both lists, but do not merge them into an ambiguous “third parties”
sentence.

### Fixed or conditional hosted processors

| Provider | Purpose and data | Current control/evidence state |
| --- | --- | --- |
| Railway | Hosting, networking, service volumes, PostgreSQL/Redis templates, logs and backups | Topology documented; real regions, backup/restore, DPA and account controls are **Gap** |
| OpenRouter and selected endpoint | AI prompts/inputs, retrieved evidence, outputs, embeddings, media for inference | Per-request no-collection/ZDR and production guardrail acknowledgement are **Enforced**; account, contract and live canary evidence are **Gap** |
| Recall.ai | Meeting attendance, media processing, transcript generation, diagnostics | Hosted production requests one-hour media retention and rejects another configured value; deployed request/account evidence, region, DPA, and deletion-failure handling are **Gap** |
| Daytona | Ephemeral complex-document extraction and observability | Credential-thin sandbox controls are **Enforced**; region and sensitive-data contract coverage are **Gap** |
| Postmark | Transactional/support email and inbound email payloads | Required when configured; retention, tracking, DPA and support access are **Gap** |
| PostHog | Fixed-stream personless surface requests, consent-gated allowlisted public-browser events, and pseudonymous minimized server/worker product events | Runtime controls are implemented. The [2026-08-26 account review](./research/posthog-rollout-evidence-2026-08-26.md) verifies the EU project, IP discard, disabled automatic capture/replay/heatmaps/errors, restricted current membership, and a pinned Launch dashboard shell. Pay-as-you-go retention, contracts/transfers, deletion completion, populated insights, and production canaries remain **Gap**. |
| Sentry | Error monitoring and source-map processing | PII defaults and scrubbers are **Enforced**; project region, retention, AI options and sample audit are **Gap** |
| Cloudflare Turnstile | Signup/support anti-abuse browser signals | **Conditional**; DPA and legal-basis record are **Gap** |

PostgreSQL, Redis, Qdrant, RustFS, Auth.js, and the AI SDK are not separate
hosted subprocessors merely because their software is used. In the documented
hosted topology, their infrastructure data path runs through Railway.

LangSmith is a development/evaluation tool, not an approved production
processor. Production environment validation rejects tracing because traces can
contain concentrated prompt and output content.

Static repository documentation currently loads fonts from Fontshare and
jsDelivr when served in a browser. Those CDNs can receive ordinary visitor
request metadata but are not intended to receive workspace content. Self-host
those assets before claiming a provider-free documentation surface.

### Customer-directed connections

Current categories include:

- GitHub, Google Drive, Linear, Monday.com, Slack, and Sentry native
  integrations;
- Telegram and Slack conversation surfaces;
- Notion, Atlassian Jira/Confluence, Stripe, Figma, and other catalog MCP
  servers; and
- arbitrary remote MCP servers supplied by a customer.

Before connection, the product must show the operator or server URL, requested
permissions/auth method, personal-versus-team sharing, selected resources,
capture behavior, possible external side effects, and how to disconnect. Google
Workspace data use must receive the prominent, specific Limited Use disclosure
required by Google's policy.

MCP output and integration snippets are untrusted and must pass through the
external-content fence before reaching an agent. SSRF validation is required for
user-supplied or discovered outbound URLs. These controls reduce prompt
injection and network risk; they do not control what the external service logs
or retains.

A provider may be added only after its owner records:

- purpose, data categories, data flow, and whether content is stored;
- controller/processor role, DPA/terms, subprocessors, transfers, and incident
  terms;
- region, retention, deletion, backup, support-access, and AI-training settings;
- least-privilege credentials, account owners, MFA/SSO, and offboarding;
- user notice, consent or other legal basis, and customer-facing controls; and
- a review date, evidence links, failure mode, and exit plan.

## 12. Retention, deletion, export, and rights

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
| OpenRouter endpoints | ZDR routes process content without endpoint persistence; OpenRouter may retain non-content operational metadata | Qualify content versus metadata |
| Recall.ai | Meeting media defaults to one hour; operational logs can remain seven days and meeting URLs fourteen days after termination; Timeline transcript persists | Never say call media is deleted instantly |
| Daytona | Ephemeral sandbox state is discarded/deleted; observability data may remain three days | Never equate ephemeral compute with zero provider retention |
| Postmark | Public default message retention is 45 days, configurable no lower than seven days; actual account setting is unverified | Name Postmark and avoid a shorter unverified promise |
| PostHog | Current source enforces zero browser capture/identifier before valid consent or after rejection, public-route-only browser analytics after opt-in, fixed personless surface streams, and explicit minimized server/worker events. The EU account review verifies disabled automatic capture and IP discard. Pay-as-you-go documents seven-year product-event retention, which exceeds the 90-day target; production and deletion completion remain unverified. | Public copy may describe the source-enforced product design and the dated account review. Do not claim that it is deployed, that retention is 90 days, that queued deletion is complete, or that pseudonymous analytics is anonymous until G-10 closes. |
| Sentry | Account retention is unverified | Describe minimized error monitoring, not a retention period |
| LangSmith | Production tracing is rejected | Development traces must use synthetic/approved data and follow the selected account retention |
| Connected services | Source retention remains controlled by the customer's provider; Timeline retains captured copies separately | Disconnecting is not deletion from either system |

Each deletion or data-subject request must have a case owner and cover, as
applicable: account rows, memberships, raw and derived records, object bytes,
vectors, queues/caches, exports, backups, analytics, error traces, email,
meeting-provider data, and other subprocessors. Preserve only records required by
law, security, fraud prevention, or contract, and record the purpose and expiry.

Team exports must preserve the requesting user's visibility and use short-lived
download access. Export generation and signed-file counts are auditable; export
archives require expiry and cleanup.

The current end-to-end deletion SLA and tested provider propagation are open
gaps. Legal copy must explain categories and criteria without promising an
unverified duration.

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
- All AI requests use the shared inference layer and the fail-closed privacy
  routing in section 7.
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
- New providers and outbound domains complete the provider review in section 11
  before production use.
- Data deletion covers derivatives and failed/partial artifacts, not only the
  primary row.
- Legal-version changes update public copy, append-only acceptance or
  acknowledgment evidence, and tests together. Terms reacceptance, Privacy
  Policy reacknowledgment, and fresh optional consent are separate gates.
- Focused privacy regression tests and the repository-wide validation gates pass
  before handoff.

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
  endpoints and fail-closed routing. This may be described as a hosted-product
  guarantee only after the current production key, account settings, and
  recurring canary evidence are captured. OpenRouter and endpoints still
  process content transiently and may retain operational metadata.
- Qdrant and RustFS run as self-hosted software in the documented Railway
  topology.
- Integration and MCP credentials use AES-256-GCM at rest in Timeline.
- Team admins do not receive a general product bypass for private or
  specific-user items.
- Timeline does not copy Recall meeting audio/video into Timeline storage;
  hosted production requests Recall's one-hour media-retention setting and
  Timeline keeps the transcript. Completed provider deletion remains
  unverified until G-07 is closed.
- A separately licensed customer-controlled deployment can move infrastructure
  and staff-access decisions into the customer's boundary.

### Prohibited until the named gap is closed

- “Fully private,” “your data never leaves Timeline,” or “no third party sees
  data.”
- “No one can train on or retain your data” without current production account,
  cache, key-guardrail, endpoint, and contract evidence.
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
  production evidence is complete.
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

## 17. Open control and evidence gaps

`TBD` owners must be replaced with a named person before the item can be marked
closed. Closing a code item requires merged tests; closing an account or legal
item requires dated evidence stored in the internal control file.

| ID | Status | Owner | Gap / completion evidence | Claim or risk blocked |
| --- | --- | --- | --- | --- |
| G-01 | **OPEN / blocker** | **TBD: founders + counsel** | Choose repository license after contributor/IP review; commit the license and contribution terms | “Open source” and general self-hosting rights |
| G-02 | **PARTIAL: code + canary implemented** | **TBD: AI/platform** | Capture production OpenRouter key-to-guardrail evidence, logging/sharing/cache settings, current DPA/subprocessors, and schedule the synthetic transcription plus ZDR-registry canary | Unqualified no-training/no-retention claim |
| G-03 | **PARTIAL: source removed** | **TBD: analytics + security** | Current source and regression tests remove the legacy Convex pageview import. Verify the deployed path; inspect prior logs/ownership and token URLs, export anything that must be retained, delete tracker-only data/deployment where proven safe, rotate still-valid credentials if affected, and retain dated evidence. | Complete tracker inventory and legacy analytics incident closure |
| G-04 | **OPEN / blocker** | **TBD: founders + counsel** | Resolve Railway and Daytona special-category-data DPA mismatch or technically restrict unsupported data | Regulated/special-category hosted use |
| G-05 | **OPEN** | **TBD: infrastructure** | Record Railway region per service/volume, public networking, storage encryption, log retention, backup schedule, and successful restore test | Residency, encryption, backup, and recovery claims |
| G-06 | **OPEN** | **TBD: privacy/vendor** | Capture executed DPAs and dated subprocessors for every fixed processor; record transfer mechanisms and incident/deletion terms | Authoritative subprocessor and transfer statements |
| G-07 | **OPEN** | **TBD: meetings** | Verify Recall region, DPA, account retention, request-level retention, support access, and deletion failure handling | Meeting residency and provider deletion claims |
| G-08 | **OPEN** | **TBD: documents** | Verify Daytona target/host, telemetry payloads/retention, DPA coverage, and April 2026 incident/credential status | Sensitive-document readiness |
| G-09 | **OPEN** | **TBD: email** | Set Postmark to minimum viable retention, verify open/click tracking, DPA, sender configuration, and support access | Email retention and tracking statements |
| G-10 | **PARTIAL: runtime + account review** | **TBD: analytics + product privacy** | The [2026-08-26 account review](./research/posthog-rollout-evidence-2026-08-26.md) verifies the EU project, IP discard, disabled automatic capture/replay/heatmaps/errors, restricted current membership, a pinned Launch dashboard shell, and queued legacy-data deletion. Prove the remaining [privacy/analytics interface](./privacy-analytics-interface.md): production fixed-stream and pseudonymous payloads, consent/private-route browser boundaries, populated insights, deletion completion, retention decision, DPA/transfers, access controls, and legal basis. | Any deployed analytics claim, 90-day retention claim, completed-deletion claim, or provider assurance beyond the dated evidence |
| G-11 | **OPEN** | **TBD: reliability** | Verify Sentry region, retention, Seer/AI settings, DPA, access, sampling, and representative scrubbed event payload | Error-monitoring retention and AI claims |
| G-12 | **OPEN / blocker** | **TBD: security owner** | Inventory named production access, enforce MFA/least privilege, document break-glass, retain access logs, and run quarterly review | “Rare, approved, and auditable” staff-access claim |
| G-13 | **OPEN / blocker** | **TBD: privacy + platform** | Define and test deletion across PostgreSQL, RustFS, Qdrant, Redis/queues, backups, exports, analytics, error monitoring, email, Recall, and connected providers | Deletion SLA and complete-erasure claim |
| G-14 | **OPEN** | **TBD: privacy + counsel** | Complete record of processing, DPIAs for meetings/communications/documents/AI/analytics, data-subject workflow, transfer assessment, and controller/processor review | Enterprise GDPR readiness claims |
| G-15 | **OPEN** | **TBD: security owner** | Assign security inbox ownership, incident on-call/escalation, private case system, tabletop exercise, and notification timer matrix | Mature incident-response claim |
| G-16 | **OPEN** | **TBD: infrastructure** | Self-host documentation, supported deployment boundary, update policy, and commercial support terms after G-01 | Self-host availability and support promises |
| G-17 | **OPEN** | **TBD: security program** | Define security roadmap, asset/vendor/access reviews, vulnerability scanning, restore/deletion exercises, and evidence archive | SOC 2 / ISO readiness |
| G-18 | **OPEN** | **TBD: web/privacy** | Self-host Fontshare/jsDelivr assets or add them to the public-site provider inventory | Provider-free/minimal-third-party docs claim |
| G-19 | **OPEN** | **TBD: legal + platform** | Archive an immutable rendered copy or content digest for each Terms/Privacy version and bind that evidence to acceptance events | Exact-text clickwrap evidence beyond version, timestamp, IP, user agent and Git history |
| G-20 | **OPEN / blocker** | **TBD: founder + accounting/counsel** | Resolve the missing annual reports and published deletion notice shown on the [official Nyxone OÜ registry card](https://ariregister.rik.ee/eng/company/16172329/Nyxone-O%C3%9C), then retain current official status evidence | Stable contracting/controller identity and publication readiness |

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
