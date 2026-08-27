# Provider privacy and data-handling research

**As of:** 2026-08-21

**Status:** Internal evidence memo; not approved public or legal copy

**Repository baseline audited:** `3778f4fbcd0086376df1e516a8d41a0a6ebda791`
**Scope:** Hosted Timeline, its configurable production services, and providers to
which customer or visitor data can actually flow from the audited code. Providers
shown only as “coming soon” are excluded.

This memo is research, not legal advice and not a substitute for signed contracts,
account-dashboard verification, a records-of-processing inventory, a transfer
impact assessment, or counsel review. Provider policies can change. Re-run the
live checks and capture contract/account evidence immediately before publishing a
privacy policy, trust page, enterprise security answer, or subprocessor list.

The worktree changed concurrently after this audit began. Repository statements
below describe the committed baseline above, using `git show HEAD`, unless a
paragraph explicitly says otherwise. Re-audit the final merged implementation.

## Executive answer

No: the committed hosted product cannot currently make the blanket claims “fully
private,” “zero data retention,” or “nothing is trained on user data.”

The evidence supports narrower statements:

- Timeline routes AI inference through OpenRouter. OpenRouter says it does not
  retain prompts or responses unless the customer opts into prompt logging or
  model-improvement data sharing, but it does retain request metadata. The
  downstream model provider still receives the input and has its own endpoint
  policy.
- The committed code sends only `require_parameters: true` as an OpenRouter
  provider preference. OpenRouter documents `data_collection: "allow"` as the
  default, and ZDR is not enabled by default. Therefore the code does not prevent
  a retaining or training-eligible endpoint from being selected.
- OpenRouter's current provider table marks the direct DeepSeek route as retaining
  prompts and permitting training. The committed primary text models are
  DeepSeek. ZDR routes exist for those model IDs, but the committed requests do
  not require them.
- The committed transcription model, `openai/gpt-4o-transcribe`, has no endpoint
  in OpenRouter's live ZDR registry. Adding a global per-request ZDR preference
  would therefore make transcription unavailable if the preference were
  enforced.
- Recall.ai is configured to retain meeting media for one hour by default, not
  zero seconds. Recall states that it does not train or fine-tune AI on Customer
  Data. Timeline does not copy raw meeting media to its own object storage, but it
  does persist transcript text.
- Postmark necessarily holds email message content. Its default retention is 45
  days, configurable to 7–365 days, and its security page says message content is
  not encrypted at rest.
- Daytona receives supported document bytes for extraction. The repo uses
  ephemeral, network-blocked sandboxes and deletes them, but Daytona separately
  documents three-day observability retention. Its standard DPA says customers
  must not submit sensitive/special-category data, which conflicts with an
  unrestricted team-document product unless another agreement or product
  restriction resolves it.
- A third-party Convex-hosted analytics script is loaded from the root layout on
  every route at the committed baseline. The script records full page URLs,
  referrers and persistent visitor/session identifiers. This can disclose invite,
  verification, callback and in-app resource identifiers. Its presence is not
  represented by the repository's PostHog analytics documentation.
- Railway, PostHog, Sentry, LangSmith, Cloudflare Turnstile, Postmark, Recall and
  other enabled services retain at least metadata, logs, messages, traces or
  challenge data for service operation. “Private” must never be used as a synonym
  for “no training.”
- The repository has no root `LICENSE`, `LICENSE.md` or `COPYING` file at the
  audited commit. Public source availability is therefore not proof that anyone
  has legal permission to copy, modify, redistribute or self-host Timeline. The
  product must not promise “anyone is free to self-host” until an actual license
  grants that right and contributor/IP provenance is reviewed.

The public-safe position today is: data is processed by a documented set of
service providers for defined purposes; some AI endpoints can be constrained to
no-training/ZDR routes after enforcement is completed; retention and residency
vary by service; a separately licensed self-managed deployment can be offered to
customers who require a different control boundary. The audited repository does
not itself grant a general self-hosting right.

## Assurance vocabulary

These terms must remain separate in product, policy and sales copy:

| Term | What it proves | What it does not prove |
| --- | --- | --- |
| No training | The provider contract/policy disallows using the request to train models. | The request may still be logged or reviewed. |
| Zero data retention (ZDR) | The inference endpoint does not persist prompt/input or response/output. | OpenRouter request metadata, network logs, enabled tools, and Timeline's own necessary storage may remain. OpenRouter also treats in-memory implicit prompt caching as compatible with ZDR. |
| Encryption in transit | Transport is protected while moving between systems. | Storage encryption, application-layer encryption, staff access controls, or deletion. |
| Encryption at rest | A storage layer is encrypted. | The provider cannot access plaintext while serving the product; customer-managed keys; per-tenant cryptographic isolation. |
| Data residency | A named dataset is stored/processed in a selected region. | Every subprocessor, support path, telemetry system or disaster-recovery copy is in that region. |
| Private | Ambiguous marketing language. | Nothing by itself. Replace it with testable statements about purpose, access, training, retention, encryption and residency. |
| SOC 2 / ISO 27001 | A named organization's controls were audited/certified for a defined scope and period. | That Timeline is certified, that every control applies to this deployment, or that breaches are impossible. |
| GDPR | A law and compliance framework. | A certificate. Do not list “GDPR” as a future certificate. |
| HIPAA | A US legal regime. A vendor capability matters only with an applicable BAA and eligible configuration. | A general-purpose product badge or substitute for a Timeline risk assessment. |

## Method and confidence

The audit first traced outbound calls, SDK initialization, environment defaults,
deployment documentation and model pins in the repository. It then checked
provider-owned documentation, policies, DPAs, trust centers and live OpenRouter
model/endpoint APIs. No third-party privacy summaries were used as authority.

- **Confirmed:** directly supported by committed code and a current first-party
  source.
- **Conditional:** code path exists, but production enablement or dashboard
  configuration was not available.
- **Inference:** a consequence of two confirmed facts, clearly identified as such.
- **Unknown:** requires a provider account, contract, deployment dashboard or
  internal policy record.

The provider certificates below belong to those providers. They are evidence for
vendor due diligence, not certificates Timeline may display as its own.

## Current processor and data-flow register

| Service | Status in repo | Data it can receive | Retention/training finding | Region/contract finding | Confidence and next action |
| --- | --- | --- | --- | --- | --- |
| Railway | Production host in deployment docs | Application traffic, Postgres rows, Redis jobs, Qdrant vectors, RustFS objects, logs and backups | Not an AI training processor. Retention follows services, volumes, backups and contract. | Multiple regions exist; repo pins none. DPA says primary operations are US with local storage options on paid plans. | **Confirmed code, unknown account.** Record every service/volume region, backup schedule, DPA version and subprocessor list. |
| Postgres/Redis on Railway | Railway templates | All relational product data; job/cache data | Railway calls database templates unmanaged: Timeline is responsible for backup, recovery, hardening and monitoring. | Follows Railway service region. | **Confirmed.** Do not market these as Railway-managed databases. |
| Qdrant | Self-hosted container on Railway | Embeddings and team-scoped vector payloads | Qdrant Cloud is not used by the documented production topology. | Follows its Railway service/volume. | **Confirmed topology; unknown dashboard.** Qdrant is software, not a separate hosted subprocessor here. |
| RustFS | Self-hosted container on Railway | Uploaded documents, source audio and exports | RustFS Cloud is not used by the documented production topology. App secrets are encrypted separately; no evidence establishes application-layer encryption of all object bytes. | Follows its Railway service/volume. | **Confirmed topology; unknown volume controls.** Verify storage encryption, backup and signed-URL policy. |
| OpenRouter + selected model provider | Required for AI | Prompts, retrieved team evidence, document/image/audio inputs, outputs and embeddings | OpenRouter says prompt logging and model-improvement sharing are opt-in, but downstream endpoint policy controls retention/training. Committed code permits collecting endpoints. | OpenRouter enterprise terms describe GCP US, SOC 2 Type II framework, DPA and subprocessors; contract tier is unknown. | **Confirmed code and public policy; account unknown.** Enforce ZDR/no-collection, disable logging/sharing, bind guardrail to key, capture DPA/subprocessors. |
| Recall.ai | Meeting-bot provider | Meeting URL, participants/metadata, audio/video, transcript and bot diagnostics | Timeline default is one-hour media retention. Recall says no Customer Data training. Accuracy mode is incompatible with Recall ZDR. Logs remain 7 days; meeting URL clears 14 days after termination. | Repo defaults to US West. Recall also offers EU Frankfurt and Tokyo. | **Confirmed.** Disclose one hour, not “immediate”; choose region; decide accuracy versus ZDR. |
| Daytona | Optional document-extraction sandbox, required for supported complex files when configured | Document bytes, filename/type, extractor process output/errors | Ephemeral sandboxes discard state on stop; repo also deletes. Daytona documents 3-day logs/traces/metrics. Standard DPA says no sensitive/special-category data. | Repo defaults to target `us`; exact host/region/subprocessors unknown. | **Confirmed path; account unknown. Critical contractual review.** Resolve special-category mismatch before accepting unrestricted documents. |
| Postmark | Outbound email and inbound-email capture | Recipient/sender, subject/body, attachments, delivery/open/click metadata | 45-day default message retention; custom 7–365 days. Message content is not encrypted at rest. Aggregate stats and suppression data can last longer. | DPA/SCC mechanism exists; account DPA version and retention configuration unknown. | **Confirmed path; account unknown.** Set minimum viable retention, inspect tracking, sign current DPA, disclose inbound/outbound processing. |
| PostHog | Optional product analytics and feature flags | Pseudonymous user ID, team ID and typed product-event properties | Repo disables autocapture, pageviews, pageleave and replay, but persists analytics identifiers in cookie/localStorage. Project retention is unknown. | Default host is EU ingestion; an EU hostname alone is not proof of project residency. | **Conditional.** Verify project region, retention, DPA, subprocessors, IP handling, consent/legal basis and property allowlist. |
| Convex-hosted custom analytics | Unconditional root-layout script at audited commit | Full URL/path/query, referrer, UTM values, screen, language, scroll/time and persistent visitor/session IDs | Custom backend schema, retention, access and downstream export are not in this repo. | Convex offers US East and EU West deployments; this endpoint's region is unknown. Convex advertises SOC 2 Type II and AWS controls. | **Confirmed and high risk.** Remove or explicitly own, sanitize and consent-gate it; inventory the external backend before policy publication. |
| Sentry | Optional error monitoring plus optional native data-source integration | Exceptions, stack traces, breadcrumbs, runtime metadata, source maps; connected team issue/release data | `sendDefaultPii` is false and repo scrubs known secrets, but unexpected error strings can still contain customer data. Actual retention and AI/Seer settings unknown. | Sentry supports US or Germany data location. DSN/account decides; repo does not. | **Conditional.** Verify region, retention, DPA, subprocessors, scrubbing, Seer/AI opt-ins and sampling. |
| LangSmith | Optional LLM tracing; default off | When enabled: text prompts/outputs and trace metadata. Binary bytes are redacted, but filenames/text/transcripts remain. | Base traces 14 days; extended traces 400 days; some metadata can persist. | Repo default endpoint is US (GCP Iowa); EU endpoint is Netherlands. | **Conditional and sensitive.** Keep off unless explicitly approved; if used, choose EU, minimize sampling/data, set retention and disclose. |
| Cloudflare Turnstile | Conditional signup/support anti-abuse | Browser/environment signals, hostname/action, challenge token and network metadata | Cloudflare says Turnstile processes necessary security signals and not form entries/user communications. Analytics include country/browser/IP/user agent/OS/ASN. | Governed by Cloudflare privacy/DPA and its subprocessors. | **Conditional.** Disclose anti-abuse processing and verify consent/legal basis where required. |
| GitHub, Google Drive, Linear, Monday.com, Slack, Sentry native integrations | Customer-selected | OAuth identity, selected source records/files/messages, webhook payloads and API requests | Retention first occurs in the customer's provider; Timeline then stores selected copies/evidence. Timeline is not able to promise deletion from the source provider. | Controlled by each customer's workspace/account and provider terms. | **Confirmed capability, conditional per team.** Treat as customer-selected connected services, not silently as fixed subprocessors. |
| Telegram and Slack conversation surfaces | Customer-selected | Bot/channel messages, files, voice notes, user/workspace identifiers and outgoing replies | Telegram cloud chats and Slack workspace retention are separate control planes; Timeline also persists captured evidence according to its own policy. | Provider/workspace settings vary. | **Confirmed capability.** Disclose both source-platform and Timeline retention/visibility. |
| Notion, Atlassian Jira/Confluence, Stripe and local Figma MCP | Customer-selected, available now | Tool arguments, results and any external side effects allowed by user/provider permissions | Each MCP server acts with connected permissions. Outputs are fenced as untrusted in Timeline but may still contain customer data and be captured. | Provider-specific. Arbitrary custom MCP adds an unbounded processor/controller category. | **Confirmed capability.** Show a just-in-time disclosure before connecting and maintain a user-visible connection inventory. |
| Fontshare and jsDelivr | Loaded by static HTML documentation CSS | Public visitor IP, user agent, referrer and requested asset | No team product data is intended. | CDN-dependent. | **Confirmed, low product-data risk.** Self-host fonts if minimizing public-site third parties. |

## 1. OpenRouter and model providers

### What the committed code does

All inference goes through the shared LLM layer and OpenRouter. At the audited
commit, the model pins are:

| Purpose | Model ID |
| --- | --- |
| Extraction, agent, summarization and task categorization | `deepseek/deepseek-v4-flash-0731` |
| Structured fallback | `deepseek/deepseek-v4-pro` |
| Vision/file/audio analysis | `google/gemini-3.5-flash` |
| Embeddings | `openai/text-embedding-3-small` |
| Transcription | `openai/gpt-4o-transcribe` |

The committed chat and embedding requests set `require_parameters: true`. They do
not set `provider.data_collection: "deny"` or `provider.zdr: true`.

OpenRouter documents these material facts:

1. `data_collection` defaults to `allow`.
2. ZDR can be enforced by account/model group, guardrail or per request.
3. ZDR means the downstream endpoint does not persist prompts and therefore
   cannot train on them. No-training without ZDR is a separate, weaker state.
4. If OpenRouter cannot establish an endpoint policy, it conservatively marks
   that endpoint as retaining and training.
5. OpenRouter itself does not retain prompt/input or response/output unless the
   customer enables private prompt logging or opts into sharing I/O for model
   improvement. It still stores request metadata.
6. OpenRouter can dynamically load-balance and fall back between endpoints for a
   model. A model name alone therefore does not prove which processor or policy
   handled a request.
7. Response caching is off unless enabled through headers or a preset. If it is
   enabled, a per-request ZDR flag does not by itself make the request ineligible
   for OpenRouter response caching; account-level ZDR disables caching. The repo
   does not set the caching header or a preset model ID, but account/preset state
   remains unknown.

### Current endpoint policy implications

OpenRouter's provider table and live endpoint registries were checked on
2026-08-21:

| Pinned use | Current relevant policy | Conclusion |
| --- | --- | --- |
| DeepSeek text models | Direct DeepSeek is marked as retaining prompts and training; separate ZDR routes exist for both pinned IDs. | Baseline routing can select a policy incompatible with “no training.” Enforce ZDR. |
| Gemini vision/audio analysis | Google AI Studio is marked no-training with 55-day retention; Google Vertex is marked ZDR. A Vertex ZDR route exists for the pin. | “Google does not train” is not “zero retention.” Require the Vertex/ZDR endpoint through policy. |
| OpenAI embedding | First-party OpenAI is marked no-training but retaining; an Azure ZDR route exists. | Require ZDR; model name alone is insufficient. |
| `gpt-4o-transcribe` | Only the first-party OpenAI endpoint is listed; it is absent from the ZDR registry. | There is no enforceable ZDR route for this exact model today. |

OpenAI's direct API policy says API data is not used to train unless the customer
opts in, and abuse-monitoring logs can be kept up to 30 days unless an eligible
customer is approved for modified abuse monitoring or ZDR. That is useful vendor
context, but OpenRouter's endpoint registry is the controlling evidence for an
OpenRouter-routed request.

Google's direct paid Gemini API terms say prompts/responses are not used to improve
products, with logging exceptions and ZDR eligibility depending on features. Again,
the practical OpenRouter route can be AI Studio or Vertex and must be constrained.

DeepSeek's consumer privacy policy and model disclosures are not a reliable
contract for OpenRouter developer-platform traffic: the privacy policy expressly
distinguishes downstream apps using the developer platform, while OpenRouter's
current endpoint table marks the direct route as training-eligible. Do not infer a
no-training promise from the model name or a model-training disclosure.

### Historical ZDR transcription candidate screen from 2026-08-21

This section records endpoint availability observed during the original audit.
It is not promotion evidence and does not authorize a model change. The current
production pin remains `openai/gpt-4o-transcribe` as the transparent
`retained_no_training_exception` until a non-customer, 24-language evaluation
meets every gate in [transcription-quality-eval.md](transcription-quality-eval.md).

The live `GET /api/v1/models?output_modalities=transcription` result and
`GET /api/v1/endpoints/zdr` registry show viable dedicated STT replacements:

| Model | Current endpoints | ZDR status | Assessment |
| --- | --- | --- | --- |
| `openai/whisper-large-v3` | DeepInfra, Together, Groq | All three observed endpoints appeared in the ZDR registry. | Historical candidate; must pass the multilingual quality gate. |
| `mistralai/voxtral-mini-transcribe` | Mistral regular and `mistral/zdr` | Only the tagged Mistral ZDR route appeared eligible. | Historical candidate; must pass the multilingual quality gate and fail closed to eligible routes. |
| `mistralai/voxtral-small-24b-2507-stt` | DeepInfra BF16 | The observed route appeared in the ZDR registry. | Historical candidate; must pass the multilingual quality gate. |
| `google/chirp-3` | Google Vertex | The observed route appeared in the ZDR registry. | Current bake-off candidate; must pass the multilingual quality gate. |
| `openai/gpt-4o-transcribe` | OpenAI | Not in ZDR registry. | Do not use when ZDR is a hard requirement. |

Gemini audio is not a drop-in STT route. OpenRouter lists
`google/gemini-3.5-flash` as accepting audio and producing **text**, while the
dedicated transcription models accept audio and produce the `transcription`
modality. OpenRouter's own guide distinguishes conversational audio analysis in
Chat Completions from the dedicated `/audio/transcriptions` API. A prompt asking
Gemini for a verbatim transcript could be built and per-request ZDR could be
enforced on Chat Completions, but it changes fidelity, response semantics,
testing, cost and likely timestamp behavior. It should not be the privacy fix.

**Superseding decision:** keep the current pin until the reproducible bake-off
produces a locked aggregate-only evidence artifact. If a ZDR candidate passes,
pin the lowest-error passing model exactly and prohibit non-ZDR fallback. If none
passes, keep GPT-4o Transcribe as the disclosed quality exception. Endpoint
policy is mutable, so deployment attestation and live canaries remain required
for every ZDR-classified role.

### Claims permitted only after controls are evidenced

After code, account and contract verification, a precise statement could be:

> Timeline configures AI requests to use provider endpoints that do not retain
> request content or use it for training. OpenRouter and Timeline may retain
> limited operational metadata, and Timeline stores the product records needed to
> provide the service.

Do not publish this until the production account proves logging and I/O sharing
are off, all relevant key guardrails are on, the transcription replacement is
live, cache settings are checked, and contracts/subprocessors are recorded.

## 2. Railway, Postgres, Redis, Qdrant and RustFS

The production setup guide deploys the web, worker and document-extraction
services on Railway. It creates Postgres and Redis from Railway templates and
runs Qdrant and RustFS as Docker images with persistent Railway volumes.

Material findings:

- Railway supports US West, US East, EU West (Amsterdam) and Singapore regions.
  Services and volumes follow the selected region. The repo's Railway JSON files
  do not pin a region, so deployment residency cannot be inferred from Git.
- Railway explicitly calls its database templates **unmanaged**. Timeline, not
  Railway, owns database tuning, backups, disaster recovery, security and
  monitoring.
- Volume backups are optional. Railway documents configurable daily, weekly and
  monthly retention windows, but the repository cannot prove they are enabled.
- Railway's DPA describes it as a processor, relies on its authorized
  subprocessor inventory and transfer mechanisms, and describes logical
  isolation, database encryption at rest, TLS/SSL/WireGuard transport, access
  controls and personnel confidentiality.
- The public DPA's processing exhibit lists sensitive/special-category data as
  “None.” Timeline is intended to hold teams' deepest work data and can receive
  health, HR, financial or other special-category material. Counsel and Railway
  must confirm whether the executed agreement differs or the service scope must
  be restricted.
- Railway's trust center lists SOC 2 Type II, SOC 3, HIPAA, GDPR and Data Privacy
  Framework materials. Those attestations belong to Railway. A Timeline HIPAA
  claim additionally requires an applicable BAA and product-wide controls.
- Qdrant and RustFS are self-hosted software in this topology. Their upstream
  companies are not hosted-data subprocessors merely because Timeline uses their
  images. The actual processor for their stored data is Railway and any Railway
  infrastructure subprocessor.
- Secrets and OAuth credentials have application-layer AES-256-GCM protection in
  the repo. No corresponding evidence establishes application-layer encryption
  of all Postgres rows, vectors or RustFS object bytes. Do not imply otherwise.

Required account evidence: service and volume region screenshots/exports,
network exposure, volume encryption confirmation, backup schedules and restore
test, production log retention, Railway DPA and subprocessor snapshot, BAA if
applicable, and named staff access procedure.

## 3. Recall.ai meeting capture

The repo defaults to `https://us-west-2.recall.ai/api/v1`. It sends a meeting URL,
bot identity, metadata and transcript-webhook configuration. Recall joins the
meeting, captures media and produces a transcript. Timeline's meeting provider
configuration defaults to one-hour timed media retention. Raw meeting audio is
not copied into Timeline's RustFS; transcript text is persisted in Timeline.

Recall's current storage documentation says:

- Custom retention covers audio, video, transcript, speaker, participant,
  meeting metadata and debug data.
- `retention: null` selects ZDR. ZDR requires `prioritize_low_latency`
  transcription. Timeline uses `prioritize_accuracy`, so its present mode cannot
  also be Recall ZDR.
- Recall does not use Customer Data to train or fine-tune AI.
- A media delete is permanent and Recall says it does not keep media backups.
- Operational logs remain for 7 days and meeting URLs are removed 14 days after
  the bot terminates.
- Data is encrypted with TLS in transit and AES-256 in AWS RDS at rest.
- Recall offers US, EU (Frankfurt) and Asia (Tokyo) regional APIs. Region is
  selected by endpoint and bots/data do not move between regions automatically.

Therefore the accurate hosted-product claim is not “we never store the actual
call” without qualification. A precise version is: Timeline does not copy meeting
audio/video into Timeline storage; Recall temporarily processes and retains the
recording media for one hour under Timeline's default configuration; Timeline
persists the resulting transcript. If “no recording retention” is required,
switch Recall to low-latency transcription and `retention: null`, validate quality,
and change the public claim.

Unknowns: executed DPA, subprocessor snapshot, production region, account-level
default, whether every bot request successfully receives the intended retention
field, support access, deletion failures and transcript retention in Timeline.

## 4. Daytona document extraction

For supported complex documents, Timeline creates a fresh Daytona sandbox,
uploads document bytes, runs the extractor, retrieves text and deletes the
sandbox in a `finally` path. The sandbox is marked ephemeral, has all outbound
network blocked, auto-stops after five minutes and receives no application
secrets. Plain text/CSV and some other paths are processed locally; image/PDF
vision fallback can still send content through OpenRouter outside Daytona.

Daytona says ephemeral sandbox state is discarded when the sandbox stops. It
also documents OpenTelemetry logs, traces and metrics with three-day retention.
That means “ephemeral” does not independently prove zero provider retention:
process output, errors and control-plane metadata need a separate inspection.

The most important contractual issue is Daytona's standard DPA exhibit, which
states “Sensitive Data or Special Categories of Personal Data: None (customers
must not submit sensitive data).” Timeline cannot know that arbitrary uploaded
team documents exclude health, union, biometric, political, sexual-orientation,
HR or other protected data. Before hosted document extraction is offered without
content restrictions, obtain a written agreement that covers the actual data or
use a processor/control plane that does.

The repo defaults `DAYTONA_TARGET=us`. Daytona's DPA lists infrastructure and
operational subprocessors across multiple countries; account target, physical
host and control-plane region must be captured. The current Daytona Trust Center
lists SOC 2 Type II coverage and April 2026 security disclosures. Review whether
the account was affected and whether credential rotation was completed. The
repo's no-secrets-in-sandbox design materially reduces, but does not eliminate,
that risk.

## 5. Postmark email

Timeline uses Postmark for transactional/support email and can receive inbound
email webhooks. Inbound payloads can include full message bodies and attachments,
which Timeline then persists as evidence. Postmark is therefore a content
processor, not merely an SMTP pipe.

Postmark's current first-party material says:

- Message content is kept for the configured message-retention period: 45 days
  by default, with 7–365-day custom retention. Seven days is the minimum; message
  retention cannot be fully disabled.
- When short retention is selected, deletion may take up to 24 hours; longer
  retention configurations can take up to seven days to clear. Aggregate
  statistics remain after message content expires.
- Bounce/spam suppression information can be retained indefinitely to protect
  deliverability.
- API and SMTP connections use TLS, but email **message content is not encrypted
  at rest**.
- Staff access to messages is described as limited to account-owner permission
  or compliance review. Postmark itself says it has not undergone a SOC audit;
  its data-center provider has SOC 2 controls.
- Postmark offers a DPA/SCC mechanism and publishes subprocessors including AWS
  and Deft, with Zendesk used for support transparency.

Unknown account facts: retention setting, open/click tracking, DPA version (the
current DPA distinguishes accounts by signup timing), sender-domain settings,
support access history and deletion behavior. Set the shortest retention that
still permits delivery investigation, disable tracking unless necessary, and
describe both Postmark and Timeline retention.

## 6. Analytics and telemetry

### PostHog

The committed PostHog integration is more privacy-minimized than default browser
analytics: it initializes only with a key, defaults to the EU ingestion hostname,
sets `autocapture`, pageview, pageleave and session replay off, and uses typed
product events. It identifies a pseudonymous Timeline user ID and groups it by
Timeline team ID. Browser persistence is `localStorage+cookie`; server events and
feature-flag checks use the same provider.

PostHog offers EU (Frankfurt) and US hosting and publishes SOC 2 Type II and
GDPR/CCPA/HIPAA materials in its Trust Center. Those facts do not prove the
Timeline project was created in the EU, that its retention was shortened, that a
DPA was signed, or that every event property is safe. Verify the project, not
only `NEXT_PUBLIC_POSTHOG_HOST`.

Required controls: event/property schema allowlist, automated tests against
prompt/transcript/document fields, IP and geolocation settings, retention,
project region, DPA/subprocessors, deletion propagation, staff access, feature
flag behavior and consent/legal basis. The current repo has no evident analytics
opt-out or consent control; counsel must decide the lawful basis rather than the
Trust page declaring one.

### Unnamed Convex-hosted analytics

At the audited commit, the root layout unconditionally loads:

`https://aromatic-caribou-889.convex.site/api/a/am_7eCe5quSdP7W1Kx7`

The script served on 2026-08-21 creates persistent `am_vid`, `am_sid` and `am_st`
local-storage values and sends `page_view` and `page_leave` payloads to the Convex
endpoint. Payloads include `location.href`, pathname, referrer, screen size,
language, UTM parameters, scroll depth and time on page.

**Inference from confirmed route + script behavior:** because it sits in the root
layout, full URLs can include `/accept-invite/[token]`,
`/verify-email/[token]?email=…`, `/sign-up?invite=…`, sign-in callback URLs,
search queries, chat session IDs, and object/document/integration resource IDs.
Even if each token later expires, forwarding it to an undocumented analytics
system violates data minimization and can create a credential exposure window.

Convex says hosted deployments can be created in US East (Northern Virginia) or
EU West (Ireland), uses AWS, encrypts data with TLS in transit and AES-256 at rest,
limits production access, and has SOC 2 Type II materials. The endpoint's region,
backend source, event schema, retention, account owners, exports, deletion and DPA
are not in this repo.

This script must be removed or brought into scope as an explicitly named provider
with URL/token redaction before capture, route exclusions, consent/legal-basis
review, retention, access policy, DPA/subprocessors and tests. The repository's
analytics guide currently describes deliberate product events and no pageviews;
it is incomplete while this script exists.

### Sentry

Sentry is optional. Browser, server and worker initialization sets
`sendDefaultPii: false`; the repo filters authorization/cookie headers and known
secret-bearing URLs, and production trace/profile sample rates default to zero.
Source maps may also be uploaded. Native Sentry integration credentials are a
separate feature that reads a customer's selected issue/release data.

This is good minimization, not a guarantee that no customer content reaches
Sentry: exception messages, stack locals, breadcrumbs and third-party errors can
contain unexpected values. Sentry supports US and Germany data locations, chosen
by account/DSN. A historical Sentry security overview states AES-256 protection
and 90-day retention, but it is old enough that plan/account evidence must replace
it. Sentry's 2026 Seer privacy overview says generative-model training on customer
data is not performed by default without permission; Timeline's Seer use is not
established, so do not turn that into a general Sentry/Timeline AI claim.

### LangSmith

LangSmith tracing defaults off. If enabled, the repo traces text prompts and
outputs plus model/latency/token metadata. It redacts binary file/image/audio
bytes, but text, filenames and transcripts are still trace content. This can be
the most concentrated copy of customer AI inputs in the stack.

LangSmith documents base trace retention of 14 days and extended trace retention
of 400 days; feedback or configuration can change tiering, and limited metadata
can remain longer. Its default SaaS endpoint is US GCP Iowa; the EU endpoint is
Netherlands and data does not migrate automatically between regions. The repo's
default URL is US.

Keep production tracing off unless there is a documented need, selected region,
sampling/minimization policy, retention, user notice, DPA/subprocessors and
restricted access. If enabled, the privacy policy must name LangSmith and explain
that prompt/output text may be traced.

### Cloudflare Turnstile

Turnstile is loaded only for signup and public support when configured. The
browser loads Cloudflare's challenge script and Timeline verifies the resulting
token with Siteverify. Cloudflare says Turnstile evaluates necessary
browser/environment and human-behavior signals and does not inspect form entries
or user communications. Turnstile analytics can include hostname, country,
browser, IP, user agent, operating system and ASN. Disclose the anti-abuse purpose,
link Cloudflare's privacy material, and record the legal basis/consent decision.

## 7. Customer-selected integrations and communication services

These providers differ from a fixed hosting subprocessor. A team administrator
chooses to connect an existing account and authorizes data movement. Timeline
must still disclose the category, requested scopes, stored copy, revocation and
deletion behavior.

### Native integrations

- **GitHub:** Timeline reads selected repository/organization material and
  receives webhooks. GitHub's General Privacy Statement was updated effective
  2026-04-27; GitHub separately publishes its DPA and subprocessor list.
- **Google Drive:** Timeline mirrors selected folders/files and receives Google
  OAuth data. Google's Workspace API User Data Policy requires a prominent,
  comprehensive disclosure and compliance with its Limited Use requirements.
  The production privacy policy must include the required Google user-data
  wording; a generic “third parties” sentence is not enough.
- **Linear:** Timeline reads selected workspace issues/projects/comments.
  Linear publishes a DPA and security material, including US/EU data-region and
  SOC 2 statements. The connected customer's actual region controls.
- **Monday.com:** Timeline reads selected boards/items/updates/WorkDocs and
  receives webhooks. Monday publishes US, EU (Germany) and APAC (Australia) data
  regions; strict EU-only processing is an enterprise configuration, not a
  default inference from an EU customer.
- **Slack:** Timeline captures selected channel/thread/file activity, can operate
  conversation surfaces and sends replies. Slack data retention is controlled by
  each workspace/plan and Timeline separately stores captured evidence. Explain
  both layers.
- **Sentry native integration:** distinct from Timeline's own error monitoring;
  it imports a customer's issues/releases into Timeline under the customer's
  authorized scopes.

OAuth and bearer tokens for these integrations are encrypted in Timeline with
AES-256-GCM. That protects secrets at rest; it does not encrypt source content
end-to-end or prevent the provider from seeing API calls.

### Telegram and Slack chat

Telegram Bot API traffic includes messages, files/voice notes, user/chat IDs and
Timeline replies. Telegram says bot chats are Cloud Chats stored on its servers;
third-party bots receive the content users send to them, and some metadata can be
kept for up to 12 months. Timeline downloads selected media, stores source
evidence and can send audio through transcription. Users must be told that both
Telegram and Timeline process the conversation.

Slack likewise applies workspace retention/settings before Timeline captures a
copy. Deleting a source Slack message does not automatically establish that every
derived Timeline fact/vector/transcript was deleted; product behavior and policy
must specify propagation.

### Hosted and custom MCP

The current catalog can connect Notion, Atlassian Jira/Confluence and Stripe MCP
servers; Figma is a local desktop MCP connection. Administrators can also add an
arbitrary remote MCP server.

- Notion warns that MCP acts with the connected user's permissions and highlights
  prompt-injection/exfiltration risk.
- Atlassian Rovo MCP can search, read and write under the user's Jira/Confluence
  permissions; organization admins can control availability.
- Stripe uses a customer-created restricted key. “Restricted” means limited to
  the permissions selected by the customer, not inherently read-only unless the
  key configuration proves it.
- Local Figma MCP does not create a new hosted Timeline processor by itself, but
  Figma remains the customer's source service and the local bridge can expose
  permitted design data.
- A custom MCP may be any operator in any jurisdiction, may log inputs, may return
  malicious content and may cause external side effects. Timeline fences tool
  output as untrusted, but that protects agent instruction flow rather than the
  external provider's retention.

The connection flow should show the server operator, URL, scopes/auth method,
team-versus-personal sharing, capture behavior and warning before consent. The
privacy policy should describe customer-directed connected services as a category
and keep a live subprocessor/connection inventory in product.

## 8. Public documentation assets

The static HTML documentation stylesheet requests Switzer from Fontshare and
Commit Mono from jsDelivr. A docs visitor therefore makes third-party CDN requests
that can disclose IP address, user agent and referrer. No team workspace data is
intended to flow. Self-hosting these fonts is a low-cost way to reduce the public
site's processor/cookie surface and strengthen a “minimal tracking” claim.

Auth.js, the AI SDK, Postgres, Redis, Qdrant and RustFS packages are not external
processors merely because their code is used. Vercel appears as a preview/fallback
URL, ngrok appears in local setup, and many provider logos are “coming soon”; none
should be listed as a current production customer-data processor without evidence
that a real deployment sends data there.

## 9. Claims matrix

### Not supportable now

- “Your data never leaves Timeline.”
- “All AI is fully private.”
- “No provider can train on your data.”
- “We use zero-data-retention models only.”
- “Meeting recordings are never stored” or “deleted instantly.”
- “All customer data stays in the EU.”
- “All data is encrypted end-to-end” or “all files are application-encrypted.”
- “Our databases are fully managed by Railway.”
- “We are SOC 2 / ISO 27001 / HIPAA / GDPR certified.”
- “We use only anonymous analytics” or “we do not track page views” while the
  committed Convex script remains.

### Supportable with careful qualification today

- Timeline's source repository is public and its team-isolation/security design
  can be inspected. Public source is transparency, not an independent security
  guarantee and, without a repository license, is not an “open source” grant.
- Qdrant and RustFS are self-hosted in the documented Railway topology rather
  than Qdrant Cloud or RustFS Cloud.
- OAuth/bearer credentials are encrypted at rest with AES-256-GCM in Timeline.
- Timeline does not copy Recall meeting audio/video into Timeline object storage;
  Recall temporarily retains the media and Timeline stores the transcript.
- PostHog autocapture, automatic pageviews and replay are disabled in the audited
  PostHog integration. This does not describe the separate Convex script.
- Sentry default PII collection is disabled and known secrets are scrubbed, but
  error payloads still require monitoring.
- A separately licensed customer deployment can move many hosted-provider and
  staff-access choices into the customer's control boundary. Self-hosting does
  not automatically remove OpenRouter, Recall, Postmark, Daytona or connected
  services; the operator must configure or replace them. No general self-hosting
  right exists in the audited repository today.

### Supportable only after verification/remediation

- AI request content is not retained or trained on: requires deployed ZDR
  enforcement, transcription replacement, account logging/sharing/cache audit,
  live canary and provider contracts.
- EU residency: requires Railway service/volume regions, provider-specific EU
  endpoints/projects, backup/support/subprocessor analysis and evidence.
- Defined deletion SLA: requires tested deletion across Postgres, RustFS, Qdrant,
  Redis/queues, backups, traces, analytics, email, Recall and connected services.
- Enterprise/HIPAA readiness: requires Timeline's own control program, signed
  BAAs where applicable and resolution of vendor DPA data-category mismatches.

## 10. Required decisions and evidence before publishing legal/trust copy

### Blockers

1. Choose and add the intended repository license, after contributor/IP review,
   before calling Timeline open source or promising unrestricted self-hosting.
2. Merge and verify a fail-closed OpenRouter privacy policy for every inference
   operation. Replace `gpt-4o-transcribe` as described above.
3. Verify production OpenRouter settings: prompt logging off, I/O sharing off,
   response caching/presets off or explicitly covered, correct guardrail bound to
   every production key, no ungoverned BYOK routes.
4. Remove or formally govern the Convex analytics script. Rotate/revoke invite or
   verification credentials if logs show they were captured and still pose risk.
5. Record the real Railway topology: region per service/volume, public networking,
   backups, restore tests, logs, storage encryption and DPA/subprocessors.
6. Resolve the Railway and Daytona DPA “no special-category data” mismatch.
7. Decide Recall posture: one-hour accurate transcription versus low-latency ZDR,
   and select/verify region.
8. Set Postmark retention/tracking and sign the applicable DPA.
9. Decide whether LangSmith is allowed in production. If yes, select region,
   sampling, retention and access; if no, enforce it off at deployment policy.

### Account/contract evidence pack

- Executed DPA and dated subprocessor snapshot for every fixed processor.
- BAA only where the product actually needs and qualifies for it.
- Provider account owner/admin list, MFA/SSO status, support-access controls and
  annual review date.
- Residency screenshot/export for Railway, PostHog, Sentry, Recall, LangSmith,
  Daytona and Convex.
- Retention screenshot/export for backups/logs, Postmark, analytics, Sentry,
  LangSmith and Recall.
- OpenRouter key-to-guardrail mapping and automated ZDR route canary.
- Incident notification periods and deletion/return obligations from each DPA.
- Internal staff access policy, production access logs, break-glass procedure,
  sanctions and customer-support authorization flow.

### Ongoing controls

- Maintain a versioned subprocessor register with at least 30 days' notice where
  contracts require it.
- Quarterly automated scan of outbound domains, SDKs, scripts and environment
  variables, compared against this register.
- Quarterly OpenRouter model/endpoint policy diff and live no-retention canary.
- Annual restore and deletion tests; deletion test should include vectors,
  objects, queues, backups and third-party processors.
- Data-protection impact assessment for meeting capture, team communications,
  arbitrary documents, AI retrieval and behavioral analytics.
- A documented process for customer access/export/deletion and connected-service
  revocation.

## First-party source register

All web sources below were accessed on 2026-08-21 unless a publication/effective
date is noted.

### OpenRouter and model endpoints

- [OpenRouter provider selection and defaults](https://openrouter.ai/docs/guides/routing/provider-selection)
- [OpenRouter data collection](https://openrouter.ai/docs/guides/privacy/data-collection)
- [OpenRouter Zero Data Retention](https://openrouter.ai/docs/guides/features/zdr)
- [OpenRouter provider logging/data-policy table](https://openrouter.ai/docs/guides/privacy/provider-logging)
- [OpenRouter providers table](https://openrouter.ai/providers)
- [OpenRouter response caching](https://openrouter.ai/docs/guides/features/response-caching)
- [OpenRouter speech-to-text API](https://openrouter.ai/docs/guides/overview/multimodal/stt)
- [OpenRouter audio input through Chat Completions](https://openrouter.ai/docs/guides/overview/multimodal/audio)
- [OpenRouter live transcription-model API](https://openrouter.ai/api/v1/models?output_modalities=transcription)
- [OpenRouter live ZDR endpoint registry](https://openrouter.ai/api/v1/endpoints/zdr)
- [Current `gpt-4o-transcribe` endpoints](https://openrouter.ai/api/v1/models/openai/gpt-4o-transcribe/endpoints)
- [Current Whisper Large v3 endpoints](https://openrouter.ai/api/v1/models/openai/whisper-large-v3/endpoints)
- [Current Voxtral Mini Transcribe endpoints](https://openrouter.ai/api/v1/models/mistralai/voxtral-mini-transcribe/endpoints)
- [Current Google Chirp 3 endpoints](https://openrouter.ai/api/v1/models/google/chirp-3/endpoints)
- [OpenRouter Privacy Policy, updated 2026-07-06](https://openrouter.ai/privacy/)
- [OpenRouter enterprise terms and security/DPA summary](https://openrouter.ai/terms-of-service-enterprise)
- [OpenAI API data controls and endpoint defaults](https://platform.openai.com/docs/models/default-usage-policies-by-endpoint)
- [Google Gemini API Zero Data Retention](https://ai.google.dev/gemini-api/docs/zdr)
- [DeepSeek Privacy Policy, effective 2026-02-10](https://cdn.deepseek.com/policies/en-US/deepseek-privacy-policy.html)
- [DeepSeek model/algorithm disclosure](https://cdn.deepseek.com/policies/en-US/model-algorithm-disclosure.html)

### Railway and self-hosted data stores

- [Railway DPA](https://railway.com/legal/dpa)
- [Railway deployment regions](https://docs.railway.com/deployments/regions)
- [Railway database templates are unmanaged](https://docs.railway.com/databases)
- [Railway volume backups](https://docs.railway.com/volumes/backups)
- [Railway Trust Center](https://trust.railway.com/)
- [Qdrant security guidance](https://qdrant.tech/documentation/guides/security/)
- [RustFS documentation](https://docs.rustfs.com/)

### Recall.ai

- [Recall storage, retention and ZDR](https://docs.recall.ai/docs/storage-and-playback)
- [Recall regions](https://docs.recall.ai/docs/regions)
- [Recall DPA](https://www.recall.ai/data-processing-agreement)
- [Recall Trust Center and subprocessors](https://security.recall.ai/)

### Daytona

- [Daytona sandbox persistence](https://www.daytona.io/docs/en/persistence/)
- [Daytona observability retention](https://www.daytona.io/docs/en/observability/otel-collection/)
- [Daytona DPA, last updated 2025-08-22](https://www.daytona.io/dpa)
- [Daytona Trust Center](https://trust.daytona.io/)

### Postmark

- [Postmark message retention API](https://postmarkapp.com/developer/api/messages-api)
- [Postmark retention add-on, updated 2025-12-08](https://postmarkapp.com/support/article/how-does-the-retention-add-on-work)
- [Postmark security and redundancy, updated 2025-10-27](https://postmarkapp.com/support/article/is-postmark-secure-and-redundant)
- [Postmark DPA, effective 2025-11-17](https://postmarkapp.com/dpa)
- [Postmark EU privacy and subprocessors](https://postmarkapp.com/eu-privacy)

### Analytics, monitoring and anti-abuse

- [Convex security](https://www.convex.dev/security)
- [Convex deployment regions](https://docs.convex.dev/production/regions)
- [Convex DPA](https://www.convex.dev/legal/dpa)
- [Convex Privacy Policy](https://www.convex.dev/legal/privacy)
- [Convex-hosted analytics script actually loaded at the audited commit](https://aromatic-caribou-889.convex.site/api/a/am_7eCe5quSdP7W1Kx7)
- [PostHog EU and US hosting](https://posthog.com/)
- [PostHog Trust Center](https://trust.posthog.com/)
- [PostHog DPA](https://posthog.com/dpa)
- [Sentry Germany data location announcement, 2024-04-16](https://sentry.io/changelog/data-storage-location-in-germany-is-generally-available/)
- [Sentry region-specific API endpoints](https://docs.sentry.io/api/)
- [Sentry DPA](https://sentry.io/legal/dpa/)
- [Sentry security overview; old source, verify against account](https://sentry.io/astro-assets/resources/resource-files/sentry-data-security.pdf)
- [Sentry Seer privacy overview, 2026-01-21](https://sentry.io/astro-assets/resources/legal/Data_Privacy_Overview_-_Seer_2026_01_21.pdf)
- [LangSmith administration and retention overview](https://docs.langchain.com/langsmith/administration-overview)
- [LangSmith retention and purging](https://docs.langchain.com/langsmith/data-purging-compliance)
- [LangSmith cloud regions](https://docs.langchain.com/langsmith/cloud)
- [LangSmith regions FAQ](https://docs.langchain.com/langsmith/regions-faq)
- [Cloudflare Turnstile overview, updated 2026-08-14](https://developers.cloudflare.com/turnstile/)
- [Cloudflare Turnstile analytics fields](https://developers.cloudflare.com/turnstile/turnstile-analytics/)
- [Cloudflare Customer DPA](https://www.cloudflare.com/cloudflare-customer-dpa/)
- [Cloudflare Privacy Policy](https://www.cloudflare.com/privacypolicy/)

### Connected services

- [GitHub General Privacy Statement, effective 2026-04-27](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement)
- [GitHub DPA](https://github.com/customer-terms/github-data-protection-agreement)
- [GitHub subprocessors](https://docs.github.com/en/site-policy/privacy-policies/github-subprocessors)
- [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy)
- [Google Workspace API User Data Developer Policy](https://developers.google.com/workspace/workspace-api-user-data-developer-policy)
- [Slack App Directory privacy guidance](https://api.slack.com/trust/privacy/privacy-policy)
- [Slack workspace retention controls](https://api.slack.com/help/articles/203457187-Customize-data-retention-in-Slack)
- [Telegram Privacy Policy](https://telegram.org/privacy)
- [Linear security](https://linear.app/docs/security)
- [Linear DPA](https://linear.app/dpa)
- [Monday privacy overview](https://monday.com/trustcenter/privacy/overview)
- [Monday Trust Center](https://trust.monday.com/)
- [Notion MCP security practices](https://developers.notion.com/guides/mcp/mcp-security-best-practices)
- [Notion privacy](https://www.notion.com/help/privacy)
- [Notion security and privacy](https://www.notion.com/help/security-and-privacy)
- [Atlassian Rovo MCP administration](https://support.atlassian.com/security-and-access-policies/docs/control-atlassian-rovo-mcp-server-settings/)
- [Atlassian DPA](https://www.atlassian.com/legal/data-processing-addendum)
- [Atlassian subprocessors](https://www.atlassian.com/legal/sub-processors)
- [Stripe API key security and restricted keys](https://docs.stripe.com/keys-best-practices)
- [Stripe DPA](https://stripe.com/legal/dpa)
- [Stripe Privacy Center](https://stripe.com/privacy-center/legal)

## Repository evidence reviewed

- `packages/shared/src/llm/{models,chat,embed,transcribe,vision,tracing}.ts`
- `packages/shared/src/meeting-bots/recall.ts`
- `apps/worker/src/document-ingestion/daytona.ts`
- `packages/shared/src/integrations/registry.ts` and provider adapters
- `packages/shared/src/analytics/posthog-node.ts`
- `apps/web/src/components/analytics-provider.tsx`
- `apps/web/src/app/layout.tsx`
- `apps/web/src/{instrumentation-client,sentry.server.config,sentry.edge.config}.ts`
- `apps/worker/src/monitoring.ts`
- `apps/web/src/lib/{turnstile,turnstile-widget}.ts`
- `.env.example`, `docker-compose.yml`, Railway JSON files and `docs/setup/*`

## Unknowns register

| Unknown | Owner/evidence needed | Publication impact |
| --- | --- | --- |
| Repository license and contributor/IP provenance | Founders/counsel + committed license | Blocks “open source,” unrestricted copying and “anyone can self-host.” |
| OpenRouter account logging, I/O sharing, caching, privacy scopes and key guardrails | Account admin screenshots/export + live canary | Blocks no-training/ZDR claim. |
| Executed OpenRouter tier/DPA and dynamic model-provider subprocessors | Legal/vendor file | Blocks authoritative subprocessor list. |
| Final merged LLM privacy code | Re-audit final commit | Baseline findings may improve, but transcription must remain available. |
| Railway regions, volume controls, backups/logs and executed DPA | Railway dashboard + contract | Blocks residency, retention and sensitive-data claims. |
| Recall production region/account retention/DPA | Recall dashboard + bot request logs + contract | Blocks meeting retention/residency wording. |
| Daytona host/region/log payloads/DPA coverage | Daytona dashboard/support + contract | Blocks unrestricted sensitive-document processing. |
| Postmark retention, tracking, DPA and support access | Postmark dashboard + contract | Blocks email retention/security wording. |
| PostHog project region, retention, DPA, identifiers and consent basis | PostHog dashboard + counsel | Blocks analytics/cookie wording. |
| Convex analytics backend owner, schema, region, retention and logs already collected | Convex project access + incident review | Blocks “minimal analytics”; may require credential/incident response. |
| Sentry account region/retention/Seer/scrubbing | Sentry dashboard + sample event audit | Blocks monitoring retention and AI claims. |
| LangSmith production enablement/region/retention | Deployment env + LangSmith dashboard | If enabled, must be named and described. |
| Staff/subcontractor access to customer data | Internal access map, logs and policy | Blocks trustworthy access-control copy. |
| Operator access audit and break-glass review cadence | Production audit-log export + named reviewer | Blocks claims that staff access is rare, approved and auditable. |
| Data-subject deletion across vectors, objects, backups and vendors | End-to-end deletion test | Blocks deletion SLA. |
| Customer-selected integration roles and deletion propagation | Counsel + product test per provider | Blocks precise controller/processor wording. |
