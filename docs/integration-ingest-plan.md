# First-Party Integration Ingest Plan

## Goal

Timeline should support the core places where work happens with real first-party
ingestion, not only live MCP tool access. A proper integration connects an
account, lets a team select resources, backfills durable history, keeps a cursor
or webhook subscription fresh, writes cited `source='integration'` raw events,
and maps provider objects into Timeline objects where useful.

MCP remains useful for long-tail live queries. It is not the product bar for
systems that teams rely on every day.

## Scope

This plan covers:

| Area | Platforms |
| --- | --- |
| Documents and knowledge | Google Drive, Notion, Confluence |
| Design and product research | Figma |
| Project and task work | Linear, Jira, Asana, Monday.com, Trello, Basecamp |
| Engineering and operations | GitHub, GitLab, Bitbucket, Sentry, Datadog |
| Communication | Slack, Discord |
| CRM and sales | Salesforce, HubSpot, Pipedrive, Attio, Close |
| Revenue and finance | Stripe |
| Support and success | Zendesk, Intercom |

Current implemented native ingestion: Google Drive, Linear, GitHub,
Monday.com, Slack workspace ingestion, and Sentry.

Everything else above must stay represented in
`packages/shared/src/integrations/registry.ts` with
`ingestStatus: 'coming_soon'` until its adapter ships. The registry test locks
this list so the catalog cannot silently drop a requested provider.

Priority 1 native integrations shipped first: Monday.com, full Slack workspace
ingestion, and Sentry. Keep them on the same provider-connection, source
selection, cursor, provider-budget, webhook-delivery, and integration-worker
foundation as the existing adapters.

## Product Bar

Every first-party integration must ship the same baseline:

| Capability | Requirement |
| --- | --- |
| Auth | OAuth where available; encrypted tokens through `crypto/secrets.ts`; clear reconnect state. |
| Resource selection | Team-safe resource picker using provider connections and team resource shares. |
| Backfill | Bounded historical import with provider cursors and dedupe keys. |
| Incremental sync | Polling, webhooks, or both; failures land in job recovery and audit logs. |
| Event model | Provider activity normalized into immutable raw events with cited external URLs; URL text becomes non-authoritative link artifact evidence and duplicate sync replays repair missing link evidence. |
| Object mapping | External work items map into Timeline objects/tasks/deals/incidents when stable enough. |
| Visibility | Team isolation through `withTeam`; no provider resource exposed unless shared. |
| Replay | Safe resync from zero without duplicating raw events. |
| Agent use | `search_integration_events` and object retrieval expose synced evidence with citations. |

## Shared Adapter Kit

Before adding more providers, keep extracting the repeatable pieces from the
implemented Google Drive, Linear, GitHub, Monday.com, Slack, and Sentry adapters.
New providers should start from
[`native-provider-template.md`](./native-provider-template.md) so policy,
webhook, budget, test, canary, and documentation expectations stay explicit:

1. Provider SDK helpers for OAuth start/callback, refresh, and token persistence.
2. Cursor helpers for per-resource backfill and incremental sync.
3. Provider sync policies that declare webhook posture, reconciliation cadence,
   budget scopes, targeted-sync support, and provisioning model.
4. Webhook verification helpers with provider-specific signing modules, shared
   delivery persistence, and `webhook-delivery` queue processing.
5. Provider budget helpers that turn documented rate limits into cooldown state
   instead of user-facing sync failures.
6. A normalized `ExternalActivity` builder for common event kinds:
   created, updated, commented, status_changed, assigned, mentioned, linked,
   resolved, reopened, deleted, deployed, failed, recovered.
7. Object mapping helpers for provider-native identities, URLs, aliases, and
   display titles.
8. A provider contract test harness that runs:
   resource listing, event normalization snapshots, cursor advancement,
   dedupe replay, visibility, token refresh, webhook verification, and failure
   recovery.
9. A secret-safe live canary entry when the provider exposes a safe credential,
   signing-secret, or API-access probe.

This is the difference between adding many integrations and maintaining them.

## Webhook and Budget Posture

Native ingestion should be webhook-first where providers send useful signed
events, wake-up-first where webhooks only announce that state changed, and
reconciliation-first where polling is still the right v1 product posture.
Webhooks are never webhook-only: every provider keeps a slow reconciliation or
manual backfill path for missed, delayed, redacted, or incomplete provider
events.

Provider APIs are shared scarce resources. Rate limits and quota cooldowns
should become provider budget pauses and calm integration status states, not
generic red sync failures. Manual sync, background reconciliation, and webhook
delivery should all check the same pause state before spending provider calls.

Current provider posture:

| Provider | V1 posture | Notes |
| --- | --- | --- |
| GitHub | Webhook-first with slow reconciliation. | Signed repo/org webhook ingress, durable delivery targets, repo-limited sync, GitHub App installation-token hydration when configured, installation-keyed budget pauses, and conditional REST reconciliation for repo surfaces. |
| Monday.com | Webhook-first for selected board activity; reconciliation for WorkDocs and legacy grants. | Token-protected challenge/ingress, board webhook provisioning, lightweight board events, item-level hydration, account-keyed budgets for new grants, reconnect/degraded handling for legacy grants, and daily WorkDocs reconciliation. |
| Sentry | Webhook-first for issue/release activity with daily reconciliation. | Signed issue-alert, issue lifecycle, and release ingress, installation/project routing, direct event normalization, and project-limited sync. |
| Linear | Webhook-first with reconciliation fallback. | Signed ingress through durable delivery targets and `webhook-delivery`, direct event writes, and catch-up sync parity. |
| Google Drive | Wake-up-first. | Channel wake-ups persist delivery targets and enqueue bounded sync; changes-cursor reconciliation remains authoritative. |
| Slack native workspace | Reconciliation-first for v1. | Selected-channel reconciliation and Slack Web API budget pauses. Conversational `/api/slack/events` remains separate. |

Production cutover for webhook-first providers requires deterministic tests,
configured provider secrets/webhook URLs, and a secret-safe live canary where
the provider exposes one. Broad polling should only be reduced after that proof
exists.

## Provider Waves

### Wave 1: Priority 1 Native Integrations

These were the strongest first native connectors because they carry daily work
state, cross-functional decisions, and operational failure signals. They are now
implemented on the shared provider-connection, resource-selection, cursor, and
integration-worker foundation:

| Provider | Ingest surface |
| --- | --- |
| Monday.com | Boards, generic records, subitems, updates, columns, status changes, owners, and WorkDocs. |
| Slack | Workspace-wide channel/thread/file/reaction ingestion beyond the current conversational capture model. |
| Sentry | Issue updates, resolved issues, and releases, mapped into cited events and incident objects. |

Exit criteria for every new wave remains the same: each provider can backfill
selected resources, run incremental sync, recover cleanly when credentials need
reconnecting, and answer "what changed last week?" with cited Timeline events.

### Wave 2: Highest Workflow Density

These follow the Priority 1 adapters and cover adjacent systems with dense work
state and decisions:

| Provider | Ingest surface |
| --- | --- |
| Jira | Projects, issues, comments, transitions, sprints, assignees, priorities, links. |
| Confluence | Spaces, pages, comments, labels, page versions, attachments, mentions. |
| Notion | Pages, databases, comments, property changes, page versions where available. |
| GitLab | Projects, merge requests, reviews, commits, releases, pipelines, deployments. |
| HubSpot | Companies, contacts, deals, tickets, notes, calls, emails, stage changes. |
| Figma | Files, projects, branches, comments, versions, shared links, and design handoff updates. |

Exit criteria: each provider can backfill selected resources, run incremental
sync, survive token refresh, and answer "what changed last week?" with cited
Timeline events.

### Wave 3: Project, CRM, and Support Coverage

These broaden the systems of record used by non-engineering teams:

| Provider | Ingest surface |
| --- | --- |
| Asana | Workspaces, projects, tasks, stories/comments, custom fields, assignees, completions. |
| Salesforce | Accounts, contacts, opportunities, activities, notes, cases, stage history. |
| Zendesk | Tickets, comments, requester/org links, status, priority, assignments, SLA events. |
| Intercom | Conversations, tickets, users, companies, notes, assignments, tags. |
| Datadog | Incidents, monitors, alerts, service events, deployment markers, recovery events. |
| Stripe | Customers, subscriptions, invoices, payments, refunds, disputes, and revenue-state changes. |

Exit criteria: Timeline can connect customer, support, and operational events to
the same objects used by sales, product, and engineering.

### Wave 4: Long-Tail but Common Work Systems

These complete the requested catalog and cover common team variants:

| Provider | Ingest surface |
| --- | --- |
| Trello | Boards, lists, cards, checklist items, comments, labels, movements. |
| Basecamp | Projects, message boards, to-dos, schedules, docs/files, comments. |
| Bitbucket | Workspaces, repositories, pull requests, commits, pipelines, deployments. |
| Discord | Servers, channels, threads, messages, attachments, reactions, voice summaries when available. |
| Pipedrive | Deals, people, organizations, activities, notes, pipeline stages. |
| Attio | People, companies, lists, records, notes, tasks, relationship/status changes. |
| Close | Leads, contacts, opportunities, calls, emails, SMS, notes, tasks. |

Exit criteria: each integration reaches the same operational bar as Wave 1, but
can ship after the shared adapter kit has made provider additions cheap.

## Event and Object Mapping

Use provider-native objects as evidence, not as Timeline's source of truth:

| Provider class | Timeline mapping |
| --- | --- |
| Docs/wiki | Document objects, raw document-change events, chunks in document search. |
| Project/task | Task/project objects, status transitions, comments as evidence. |
| Engineering | Task/incident/release objects, code-review and deploy events. |
| Observability | Incident objects, alert/recovery events, service/topic entities. |
| CRM | Company/person/deal objects, stage changes, notes and activities. |
| Support | Company/person/ticket objects, pain themes, SLA and assignment events. |
| Communication | Person/topic/project evidence, decisions, attachments, thread summaries. |

Raw provider data remains immutable once written. Derived objects can be
re-extracted when mapping improves.

## Generic Ingest Webhooks

Generic ingest webhooks are implemented as named, team-managed, evidence-only
capture surfaces for arbitrary textual payloads. They complement native
integrations when a team needs to send events from a tool that does not yet
deserve first-party provider support.

Keep these boundaries intact as native integrations expand:

- Webhook events may support search, answers, timeline moments, and
  approval-backed proposals, but they must not directly mutate canonical
  workspace state.
- Native provider adapters remain the path for authoritative synchronization,
  cursor semantics, and direct object/task/deal/incident updates.
- Webhook credentials may rotate over time while preserving the named source.
  Store only credential hashes, and show plaintext secrets only at creation or
  rotation time.
- Webhooks accept text-like bodies only: JSON, XML, form-encoded, CSV, NDJSON,
  plain text, and unknown text-like content types. Binary and file intake should
  use future source-file flows.
- `occurred_at` is the Timeline receipt time. Provider-reported timestamps stay
  evidence that extraction can interpret.
- Each distinct accepted delivery is an immutable raw event. Duplicate
  deliveries from the same webhook inside the dedupe window should not create
  additional raw events, while distinct burst deliveries remain separate source
  evidence that the timeline display may bundle.
- Payloads are untrusted external content. Extraction, proposal generation, and
  agent-facing snippets must treat sender-authored instructions as evidence, not
  as system or developer instructions.
- Disabling a webhook stops future intake and proposal generation for that
  source. It must not delete, merge, or hide already-captured evidence.

The remaining product gap is cross-source evidence review for generic webhook
events. For example, a Pipedrive webhook delivery, a Telegram discussion, and an
email thread may together justify a task or deal update even when no single
event is enough. That synthesis belongs in a future evidence-review mechanism,
not in the event-local webhook proposal path.

## Implementation Checklist Per Provider

1. Add or update the catalog entry with `ingestStatus`.
2. Add env vars and setup docs only when the native adapter is actually
   implemented.
3. Implement provider module under `packages/shared/src/integrations/providers`.
4. Add OAuth callback/start behavior if OAuth differs from existing helpers.
5. Add listable resource types and team activation semantics.
6. Implement backfill and incremental sync.
7. Add provider policy metadata for webhook posture, reconciliation cadence,
   budget scopes, targeted-sync support, and provisioning model.
8. Add webhook route only when provider webhooks are reliable and signed.
9. Persist accepted webhook deliveries before asynchronous processing.
10. Normalize events through `writeIntegrationEvents`.
11. Add object mapping hints and display-title metadata.
12. Parse provider rate-limit metadata into provider budget pauses.
13. Add provider contract tests and targeted worker/API tests.
14. Add or update a live canary probe when it can run without exposing secrets
    or mutating production data.
15. Update `docs/setup/integrations.html`, README, and product docs.
16. Run `pnpm validate`, `pnpm run doctor`, and provider-specific tests.

## Catalog Status

The integration catalog must never imply that MCP equals native ingestion.
Use these rules:

| Catalog field | Meaning |
| --- | --- |
| `status: 'native_available'` | Native adapter exists and env credentials are configured. |
| `status: 'native_unconfigured'` | Native adapter exists but env credentials are missing. |
| `status: 'mcp_available'` | Live MCP tool access is available. This is not passive ingest. |
| `status: 'coming_soon'` | Not connectable in the product yet. |
| `ingestStatus: 'implemented'` | First-party Timeline ingestion exists. |
| `ingestStatus: 'coming_soon'` | First-party Timeline ingestion is planned. |

When a provider has MCP today and native ingestion planned, keep both facts
visible: `status: 'mcp_available'` and `ingestStatus: 'coming_soon'`.

## Open Decisions

1. Whether Jira and Confluence should share one Atlassian OAuth connection while
   appearing as separate catalog/provider resources.
2. Whether support systems should create Timeline task objects by default or
   only link evidence to company/person/ticket objects.
4. How much historical backfill is safe by default for chat-heavy systems like
   Slack and Discord.
