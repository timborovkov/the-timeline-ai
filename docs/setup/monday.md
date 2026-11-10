# Monday.com

Timeline imports selected boards once, then uses board webhooks for routine changes. A daily activity-log sweep recovers identifiable missed board changes without rereading every item. Large activity windows advance one log page at a time through durable checkpoints, so a quota pause resumes from the unfinished page. Selected WorkDocs are checked daily and their blocks are fetched only after metadata changes. Automatic monday GraphQL requests share a 100-call UTC-day budget per account; webhook provisioning and backfill pause when that budget is exhausted and resume after reset. Resource discovery can be retried after reset. A missed comment edit or reply that does not appear in activity logs may require a manual resync.

Timeline uses monday.com's OAuth app flow, not a marketplace-only integration recipe. The app needs read scopes for boards, users, updates, WorkDocs, and account metadata so selected boards and docs can become cited Timeline evidence and provider budgets can be keyed by the monday account instead of the connecting user. It also needs webhook read/write access so Timeline can provision selected board webhooks automatically.

1.  Open [monday.com Developer Center](https://developer.monday.com/apps), create an app, and open its OAuth / Permissions settings.

2.  Add the redirect URI: `https://thetimeline.cc/api/integrations/monday/callback`.

3.  Add these OAuth scopes exactly: `boards:read`, `users:read`, `updates:read`, `docs:read`, `account:read`, `webhooks:read`, and `webhooks:write`. Timeline also sends the same space-separated scope list in the OAuth authorize URL.

4.  Copy the app's **Client ID** and **Client Secret** from the Basic Information / OAuth settings.

5.  Set:

        MONDAY_CLIENT_ID=...
        MONDAY_CLIENT_SECRET=...
        MONDAY_WEBHOOK_SECRET=...

6.  Timeline provisions board webhooks automatically for activated board sources using `https://thetimeline.cc/api/webhooks/monday?token=<MONDAY_WEBHOOK_SECRET>`. The route verifies the token, echoes monday.com's `challenge` body during URL verification, persists board deliveries, and lets `webhook-delivery` process selected board targets. If the app lacks `account:read`, `webhooks:read`, or `webhooks:write`, Timeline skips provider-side webhook provisioning, keeps selected-resource reconciliation running, and raises reconnect attention for the connection owner after you add the scopes.

7.  Any team member can connect Monday.com from the native catalog. The member chooses which boards and WorkDocs are shared with the current Timeline team. Monday.com classic subitem boards are identified by monday's `Board.type=sub_items_board` and hidden from this picker because choosing the parent board already imports its subitems. A board is not hidden merely because its user-defined name begins with “Subitems of”.

8.  A team admin activates shared sources from `/app/connections/sources`. The integration worker imports board schema, generic records, subitems, item-update conversations and threaded replies, status changes, owners, column changes, and selected WorkDocs into cited timeline events. Activation, newly added selections, and retries with an unresolved sync error enqueue a historical backfill immediately and reconcile webhooks independently, so a webhook failure does not block older items. Classic subitem webhook payloads are routed through `parentItemBoardId` and hydrate against the selected parent board. Source-deletion deliveries durably tombstone only their matching update or reply: captured content stays immutable for audit while normal history and retrieval omit it, and any affected object summary is invalidated before it can remain retrieval-visible, including a summary sourced only through the update's artifact evidence association. Board pages fetch item shells first, then hydrate update/reply pages per item only within the raw-event writer budget. Update history resumes from a reverse-chronological creation-time and update-ID boundary, so updates inserted before a continuation do not shift its logical position. The stable boundary and exact deferred item, update, or reply target commit together before BullMQ delivery, so large conversations resume after contention or queue outages without re-emitting completed updates or retrying in a hot loop. Multi-level boards use monday's `hierarchy_scope_config: "allItems"` query so descendants at every supported depth are imported from the real board. Daily activity-log recovery can recover identifiable missed lifecycle and field changes; a change absent from both its webhook and activity logs requires manual resync. Selected WorkDocs reconcile through their own daily cursor. Agent retrieval resolves the visible provider- and selection-eligible event IDs in Postgres before semantic search, so historical helper-board events never consume the semantic result budget. Candidate filtering is capped at 10,000 visible events and reports truncation instead of issuing an unbounded sequence of vector searches. Item and subitem dedup keys are lifecycle-stable (status bucket, not `updated_at`), and sync/webhook share that same key family so column text or trigger UUID churn reuses the raw event; updates, docs, and board-schema events key by stable ids.

9.  Timeline pins monday API version `2026-04`. Board pagination cursors are treated as valid for at most 60 minutes. Initial imports use 20-item pages and enqueue resource-targeted continuations while more pages remain. If an account budget pause lasts past the provider cursor lifetime, the item walk restarts from page one and deduplication prevents duplicate Timeline events. A failed or inaccessible board is recorded as a partial failure without preventing the remaining selected boards from syncing.

<span id="slack-native"></span>

Shared prerequisites, health and resync: [integrations](integrations.md).
