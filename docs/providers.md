# Provider and data-flow register

This register describes the configured data paths and known assurance limits. Source controls and dated account observations are different kinds of evidence. Open contract/account checks are owned by [security gaps](security-gaps.md), not duplicated here.

## Services

A fixed subprocessor is a provider Timeline selects to operate the hosted
service. A customer-directed service is connected or invoked by the customer.
Maintain both lists, but do not merge them into an ambiguous “third parties”
sentence.

### Fixed or conditional hosted processors

| Provider | Purpose and data | Current control/evidence state |
| --- | --- | --- |
| Railway | Hosting, networking, service volumes, PostgreSQL/Redis templates, logs and backups | Topology documented; real regions, backup/restore, DPA and account controls are **Gap** |
| OpenRouter and selected endpoint | AI prompts/inputs, retrieved evidence, outputs, embeddings, media for inference | In hosted production, role-based privacy classification, per-request no-collection/ZDR for required roles, cache disablement, the official API origin, and a key/guardrail/catalog/policy-bound attestation are **Enforced in code**. A self-managed operator owns an alternate compatible endpoint and its controls and cannot reuse hosted assurances. Provider-side assignment/settings still require management-key deployment evidence, and the disclosed voice-transcription retention exception, contract, multilingual evaluation, and live evidence remain **Gap** |
| Recall.ai | Meeting attendance, media processing, transcript generation, diagnostics | Hosted production requests one-hour media retention, allows only documented HTTPS regional API hosts, pins transcripts to the application callback, closes local transcript acceptance atomically, and reports cancellation success only after provider confirmation; failed confirmations are retried. An explicit `self-managed` mode owns alternate endpoints and retention. Deployed request/account evidence, region, DPA, and deletion-failure handling are **Gap** |
| Daytona | Ephemeral complex-document extraction and observability | Credential-thin sandbox controls are **Enforced**; region and sensitive-data contract coverage are **Gap** |
| Firecrawl (SideGuide Technologies, Inc. d/b/a Firecrawl) | First-run public website crawl: the submitted public URL and fetched page content, returned as markdown | Code sends only a SSRF-validated public URL to `https://api.firecrawl.dev/v2/crawl` with markdown-only scrape options, a five-page cap, and no JSON mode. Firecrawl honors robots.txt (ignore is Enterprise-only). Published privacy policy names the Delaware operator and US servers; crawl results remain retrievable for 24 hours. Broader page-content retention, DPA, and Enterprise ZDR are **not claimed**. Account/contract evidence is **Gap**. |
| Resend | Transactional/support email and inbound email payloads | Domain `in.thetimeline.cc`, `eu-west-1` sending, inbound receiving, `email.received` webhook, and domain-level open/click tracking **Verified** 2026-11-09 from the Resend account. Retention, US storage, DPA, and subprocessors are cited only as Resend's published statements. Signed DPA on file, custom/minimum retention, API key scope, and support access remain **Gap** |
| PostHog | Fixed-stream personless surface requests, consent-gated allowlisted public-browser events, and pseudonymous minimized server/worker product events | Runtime controls are implemented. The [2026-08-26 account review](evidence/posthog-rollout-evidence-2026-08-26.md) verifies the EU project, IP discard, disabled automatic capture/replay/heatmaps/errors, restricted current membership, and a pinned Launch dashboard shell. Pay-as-you-go retention, contracts/transfers, deletion completion, populated insights, and production canaries remain **Gap**. |
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
Drive connection and reconnect open a contextual Limited Use disclosure covering
access, use, storage, sharing, deletion, billed change-judging / document
extract, and no general-model training, immediately before Google OAuth.
Continue to Google is the affirmative action; a separate checkbox is not treated
as a blanket Google requirement. The published Privacy Policy and public Drive
connector page carry the same facts. A personal OAuth disconnect deletes stored
tokens and does not cancel provider watches or delete Drive snapshots. An admin
workspace-source removal stops future capture and, where implemented, cancels
provider-managed watches; Drive source removal also deletes change snapshots and
latest extracted text. Neither action deletes already captured timeline events.

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

## Evidence

- [Provider research baseline and later dated observations](evidence/provider-privacy-research.md).
- [PostHog account review](evidence/posthog-rollout-evidence-2026-08-26.md).
- [Polar sandbox identity evidence](evidence/polar-team-identity-2026-10.md).

Recheck provider policies, regions, retention and contracts before changing a public assurance. The date of a source document is not proof of current account state. Customer-directed connections remain subject to their own source permissions and disconnect/deletion behavior.

