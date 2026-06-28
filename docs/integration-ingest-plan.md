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
selection, cursor, and integration-worker foundation as the existing adapters.

For the plan to move polling-heavy native ingestion from poller-led sync to a
webhook-first, provider-budget-aware model, see
[`integration-webhook-transition-plan.md`](./integration-webhook-transition-plan.md).

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
