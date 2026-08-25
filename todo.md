# The Timeline - Build Plan

Ordered roadmap. Keep this file short: shipped work is summarized, open work is
actionable.

## Current Status

The product baseline through Phase 13 is largely shipped: foundations, capture
surfaces, workers, extraction, embeddings, agent chat, objects, curated boards,
tasks, documents, meeting bots, calendar basics/subscriptions,
integrations/custom MCPs, Slack, onboarding, visibility controls, exports, job
recovery, public help/legal, approval-backed object and board memory, and
personal universal pinning across durable workspace content. Telegram and Slack
direct text now share the durable agent runtime and web-visible private chat
history; trusted groups and channels remain ingestion-first while also exposing
the scoped, proposal-only team agent through explicit ask commands.

This file now tracks only remaining work and recurring operating obligations.
Use the repository history, release notes, and phase PRs for shipped
implementation detail.

## Product North Star

Reframe remaining work around the path from passive capture to self-maintaining
records:

`capture → evidence → generated communication → object/project/account state → self-maintaining CRM/project layer`

- Capture: work enters through Slack, Telegram, meetings, email, documents,
  calendar, native integrations, custom MCPs, and web notes without asking the
  team to update another system first.
- Evidence: raw events, document versions, transcript chunks, integration
  events, calendar rows, and object/task changes stay inspectable and cited.
- Generated communication: updates, daily digests, handoffs, and answers are
  generated from evidence so teams stop manually reporting on work they already
  did.
- Object/project/account state: durable operational memory emerges from the
  event history through extraction, retrieval, and approval-backed state
  changes. Events are classified as communication, captured work, or pulses
  so related records can join without dumping high-volume streams into LLMs.
  See [`docs/relational-memory.md`](./docs/relational-memory.md).
- Self-maintaining CRM/project layer: for teams that trust the evidence and
  approval path, Timeline should reduce or replace manual CRM and project
  tracker upkeep rather than asking people to maintain parallel records.

## Beta Readiness

- [x] Audit security-relevant team export creation/download and job recovery
      mutations through `team.export_create`, `team.export_download`,
      `job.retry`, and `job.dismiss`, including rejected attempts and mode,
      target, recovery-kind, and outcome metadata.
- [ ] Add per-team monthly vision-spend caps and a dashboard. Vision OCR is much
      more expensive than text extraction; text-based PDFs now extract locally
      via Daytona sandbox text extract, but scanned/mixed PDFs and images still need a clear
      budget guardrail before heavy dogfooding.
- [x] Add dogfood document content: contracts, deal docs, internal guides,
      policies, office rules, onboarding docs, and customer notes. The reusable
      Acme Labs demo corpus now seeds those documents plus the broader month of
      weekday-scale use (about a hundred events per workday, collapsing into
      moments); see `docs/demo-corpus.md`.
- [ ] Surface terminal meeting bot failed states in the operations/job dashboard
      with a manual retry or rejoin path. Scheduled Saved Meetings already retry
      one in-window no-show automatically; final failures are captured as
      `meetings.status='failed'` or `meetings.status='no_show'`.
- [ ] Validate Meta Official Business Account/Groups API eligibility, then deliver
      the guarded, forward-only WhatsApp group and direct-message capture pilot
      described in `docs/whatsapp-groups-implementation-plan.md`. Do not present
      it as arbitrary WhatsApp-group sync or historical import.

## UX Overhaul

Direction: Quiet Archive. Lead with human meaning, reserve Commit Mono for
timestamps, citations, shortcuts, counts, code, and recognizable external
identifiers, and keep internal IDs or raw payloads inside closed technical
disclosures. Use sentence-case Switzer headings outside explicit audit indexes.

- [x] Shared collection empty states: one `EmptyState` for indexes, queues,
      and directories, with quiet dim icons, create/recover actions, and
      waiting copy for proposals, notifications, and captured work.
- [ ] Timeline moments redesign: turn `/app/timeline` from a raw activity log
      into bundled, evidence-backed work moments with deterministic grouping,
      source-specific adapters, AI-assisted titles/summaries, and an advanced
      raw source event mode.
      First slice shipped the Moments/All events mode split, quieter chrome,
      weighted rows (story / record / pulse), Linear-style single-icon rows,
      a wider family-aware inspector with collapsed original-source viewers,
      Ask citation previews that name transcript/calendar/document/Timeline
      destinations and reuse that original-source viewer,
      sentinel infinite scroll with virtualized archive rows and no inventory
      chip,
      GitHub workflow bundling, and the
      `search_timeline_moments`/`get_timeline_moment` agent tools, and the
      shared `@timeline/shared/timeline-moments` projection. Outbound MCP now
      has team-visible moment search/list/expand tools. Bounded server-side
      moment-page scanning keeps first-page groups from splitting/skipping, and
      focused links hydrate visible deterministic siblings for the selected
      moment. Moment rows now expose shared stable anchors for UI, chat-agent,
      and outbound MCP deep links, and mixed raw-page boundaries advance without
      looping the same bundled moment. Agent and outbound MCP moment
      search/list/expand paths now hydrate complete visible source siblings
      before returning raw-event IDs, and supported deterministic moment IDs
      hydrate through bounded visible-event lookup or exact source-metadata
      lookup for email, meeting, calendar, GitHub workflow, GitHub PR/review,
      document, Slack, Telegram, ingest webhook, and generic provider-object
      moments.
      `/api/timeline` and the initial server-rendered page now expose an
      additive server-built `timeline_moments_page.v1` DTO with raw-event
      compatibility and debug-gated pagination diagnostics; the client feed now
      hydrates those DTOs into the renderer with local grouping as fallback.
      Debug diagnostics now summarize missing provider grouping metadata by
      provider and raw event, so weak integration/webhook grouping can be
      explained without polluting the normal UI. Dev seed provider metadata now
      produces human-readable GitHub PR/review bundles, GitHub CI workflow
      bundles, Linear issue, Slack channel, and meeting moments for local
      screenshot QA. Timeline filters now refine visible events by integration
      provider and observed resources/conversations (including Monday.com
      boards, GitHub repositories, Slack channels, and Telegram chats) through
      shareable URL state without exposing private source names. Timeline pages
      and the API now
      accept `moment=<moment-id>` for supported deterministic moment IDs,
      hydrate bounded visible evidence, preserve the cache key, and keep the
      focused moment visible through filters. Focused raw-event and moment links
      now auto-open the shared inspector content and mark selected rows with
      `aria-current`. Generic integration moment IDs now hydrate by provider
      plus either `external_object_id` or `external_event_id`. AI presentation
      cache rows now persist in Postgres with team-scoped provenance
      fingerprints, and the UI, chat-agent tools, and outbound MCP moment tools
      consume cached titles/summaries only when the current visible evidence
      matches the stored key. Eligible uncached moments are queued from timeline
      reads without blocking the page/API response, then filled asynchronously
      by the worker after rebuilding the same visible cache key. Daily digest
      generation now summarizes bundled moment briefs, applies matching cached
      AI presentations, and writes narrative overview and section prose instead
      of PR or CI inventories. Pull-request numbers, commit hashes, CI run IDs,
      ticket keys, and object UUIDs are banned from digest text: the generator
      scrubs them from the briefing packet and rejects a draft that still lists
      them. Home, Work → Digests, and email reuse that
      payload: the latest digest stays folded, the header shows the digest
      date, and the covering range stays footer metadata. Activity is a count
      strip of new moments, proposals, pending approvals, tasks, and objects.
      Task and object blocks
      cover created or completed work and link to the object on the dashboard,
      calendar rows in the window and upcoming link to the specific event, and
      email includes dashboard shortcuts. Repeating calendar series collapse to
      one upcoming entry. Empty sections and empty groups are omitted. Quiet
      windows skip summarization and outbound delivery unless the recipient has
      fresh local-cycle activity, pending approvals, new or completed objects,
      or calendar events in the digest window; upcoming calendar alone does not
      trigger a send. Raw
      eventCount / sourceDistribution remain for internal metrics and per-source
      detail. Timeline Moments chrome
      no longer uses IndexStrip loaded counts; All events keeps source-event
      grouping with uniform pulse weight. The
      `timeline-moment-presentations` worker script now provides bounded,
      dry-run-first production prewarming for missing AI presentation cache jobs.
      Timeline page/API reads now emit privacy-safe `timeline_moments_viewed`
      counters for mode, filters, row-count reduction, scan pressure, missing
      grouping metadata, AI presentation cache status, and visibility cache
      partitioning without exposing raw content. Timeline browsing now ends at
      the current instant by default; an explicit upcoming control and future
      date filters are bounded to seven days so recurrence materialization
      cannot crowd historical work out of the archive.
      The archive CollectionToolbar sits flush under the 48px shell header,
      keeps Search timeline, a Filters trigger,
      and horizontally scrollable source presets; infinite scroll re-observes
      the sentinel after each page, and virtualized rows also prefetch via
      `onEndReached`. Compound toolbar slots stay visible from server pages
      through a `data-collection-slot` marker.
      An opt-in live OpenRouter smoke test (`OPENROUTER_LIVE_TESTS=1`) now
      verifies the presentation prompt and schema through the real structured
      LLM boundary.
      Remaining work is future non-integration source moment-ID coverage, future
      handoff/update DTO design, and live adapter payload fixtures for providers
      as they ship.
- [x] U1 — Design-language softening: new `PageHeader` + `SectionHeading`,
      surface split (`IndexStrip` stays on explicit audit/operator
      views; Timeline uses a sticky collection toolbar; standard pages get a sentence-case `H1`),
      update `design.md` in the same PR.
- [x] U2 — Connect-flow wizard: one guided Connect → Choose → Done flow
      per provider; hide `externalId` / `resourceKind` / `.org` kinds;
      fold `me/connections` + `team/integrations` activation into steps.
- [x] U3 — Actionable errors: Reconnect / Retry / Re-share CTAs beside
      every error chip; raw `res.text()` → human sentence + collapsible
      Details; no empty state telling users to edit env.
- [x] U4 — Discoverability: Sources hub → Connections status overview +
      one-click fix; timeline citation→inspector coachmark; compact Home setup
      prompt with one next action.
- [x] U5 — IA consolidation: merge Sources + Team integrations into one
      Connections area; admin-only Admin group; 8 top-level destinations
      (down from 13+); redirects + keymap updates.
- [x] U6 — Quiet Archive polish and verification: curated Linux visual baselines
      for a few high-value routes (not a full surface×theme matrix), full
      browser QA, `pnpm validate`, and React Doctor 100.
- [x] U7 — Universal personal pinning: replace separate board/object pins with
      one ordered mixed collection for objects, boards, documents, meetings,
      calendar series, and timeline moments; add Home preview, Work management,
      detail/list/search controls, accessible reordering, visibility-safe
      restoration, merge/deletion handling, and explicit-intent Ask tools.
- [x] U8 — Collection density, action toasts, and view-only approval
      previews: Linear-style optimistic rows, selection-bar bulk actions,
      Approvals select-all on the loaded queue and multi-item bundle headers,
      live object/event diffs, title-first calendar chips, and the same
      toolbar/button/skeleton contract on Approvals, Calendar, Connections,
      Team, Meetings, Timeline, and remaining work surfaces. Mutations use
      one `notifyAction` / `notifyProgress` lifecycle (150ms delayed spinner,
      mapped sentence-like errors, compensating Undo, CopyButton, same-surface
      Undo on light and dark toasts) instead of inline Saving/Saved chips.
      Calendar Edit event dialogs link to inspectable workspace objects;
      object Calendar sections link back to the focused event. Job recovery
      and Reconciliation reuse the same dense collection rows, with IDs and
      raw errors in Title/Context hover titles.
- [x] U8b — Collection chrome: full-bleed board list, compact kanban
      cards with next step under the title and no on-card Move control, view
      toggles on the search/filter row, slim Add item / New object / Create
      board actions, matching collection loading skeletons, and `N of M`
      infinite-scroll counts. Board kanban mutations stay on `notifyAction`
      (no Saving/Saved chips). Board kanban and grouped list virtualize
      against their inner scrollers. The legacy board Table spreadsheet was
      removed; `?view=table` maps to grouped list. Task kanban pages with
      card skeletons instead of Loading more labels.
- [x] U8c — Object and task detail density: Linear-style object page and
      task peek on one `DetailRail` surface panel, 8px section stack, why-this-exists
      lead copy, Home-destination icon pin, floating Ask binder, overflow Repair/Add task, list
      `returnTo` + `scroll={false}`, and no empty memory theater cards.
- [x] U8d — Remaining settings and directory density: Team settings, Connections,
      Meetings, Calendar, Slack, Telegram, inbox, and audit metadata use compact
      hairline forms, NativeSelect, one primary action, tooltiped icon row
      actions, and relative age plus hover datetime.
- [x] U8e — Personal pin controls: one `Pin` glyph with tooltip **Pin to Home** /
      **Unpin from Home**, toast **Pinned to Home** / **Unpinned** (Undo only),
      mixed Home and Work previews, dense-row overflow plus quiet pin glyph,
      Work overview Boards kept separate from the mixed pin list, and Ask
      object bindings labeled **About {name}** rather than Pin. Folders, Ask
      chats, approvals, connections, and raw events stay unpinnable.
- [x] U8f — Object discussions: Linear-style activity + comments on object
      pages and the task peek, `@mention` autocomplete, in-app mention
      notifications (self-mentions recorded, not notified), unread mention
      pings at the top of Work, comment-count glyphs on object/task/work
      rows, and `@The Timeline Bot` pings that reply in-thread.
- [x] Floating Ask: replace per-page Ask-about buttons with one context-aware
      float on every authenticated page except Home and full Ask. Close keeps
      the thread; New resets it. The agent sees the current view first and a
      capped trail of earlier views (documents, timeline events/moments,
      meetings, calendar events, tasks, boards, and setup pages). Selected
      items supply names; empty list pages keep the route label. `⌘J` /
      `Ctrl+J` lives on the launcher. Desktop is a non-modal panel; mobile is
      a modal sheet. Home still hands questions into `/app/chat`. Full Ask
      shows linked context badges. `search_app_guide` / `get_app_route` cover
      the float; Telegram and suggestions stay out.

## Workspace Reconciliation

- [x] Build the replacement reconciliation engine architecture: normalized
      evidence, artifact resolution, authority policy, output-backed approvals,
      and deterministic/live reconciliation evals.
- [x] Propose Timeline task status and assignee updates from GitHub PR/issue
      lifecycle fields without running the suggestion or extract models: merged
      PRs and closed issues enqueue a coalesced approval-backed `done` job
      keyed by GitHub work-item id, not by a time window of unrelated events.
      GitHub actor/assignee logins map to team members through the person-owned
      GitHub connection (identity: that login belongs to this teammate), a unique
      compact name match, or a unique email local-part — never by attributing
      work to whoever connected the integration. Matching uses provider ids,
      aliases, and high-confidence repo+PR-number titles. Pending unaccepted
      task creates are living: later merged PRs or closed issues refresh the
      same approval in place (status, aliases, actor, new evidence) instead of
      rotting. Comments, reviews, commits, and CI stay out of this path because
      they are not completion. Per-connection ingest processing is rate-limited.
      Daily object cleanup backfills the same proposals for already-ingested
      GitHub clusters.
- [x] Attach communication task proposals to existing client/project hubs by
      unique name mention **and container labels**: a Faba meeting, Slack
      channel `acme-project-development`, or Monday board `Faba-ext` can use
      the matching company/project even when they are not in the 40 most
      recently updated objects. Distinctive tokens match (`Faba` in
      `Faba website redesign`, `acme` in `acme-project-development`); generic
      words and generic containers (`website`, `meeting`, `#general`) do not.
      Two named clients stay unattached. Unedited pending creates whose
      evidence overlaps a later window are amended in place when that later
      evidence uniquely names the hub. Ask retrieval is unchanged —
      embeddings still recall; they still do not write. Frozen by
      [ADR 0015](./docs/adr/0015-proposal-writes-qualify-hubs-from-mentions-and-container-labels.md).
      Path from this point to the ideal engine:
      [`docs/relational-memory.md`](./docs/relational-memory.md)
      (Path from here to the ideal engine).
- [x] Opt-in live messy proposal-engine eval
      (`pnpm test:proposal-engine:live`): real models, real embeddings/Qdrant
      when configured, realistic noisy payloads (~90% messy: Sentry spikes,
      GitHub Actions pulses, Bugbot findings, buried ids, typo fragments,
      mention soup, truncated paste, silent calendar-linked meetings, outcome
      evidence without "this is complete"), isolated team, cleanup afterwards.
      Not part of CI. Safe name-maps are the minority. Covers Slack/Monday
      qualify, generic `#general` refuse, mixed-client refuse, living pending
      amend, pulse/finding skip, alias stamp, cosine-recall-is-not-a-write,
      implicit branding `done`, two-task refuse (qualify strips a guessed
      `done`), file-share no-create, pending-create prompt section,
      applyable proposal payloads (assignment names, calendar aliases,
      relationship endpoints, exact-name duplicate hub rewrite), and
      empty-model / timeout / invalid-JSON fallback mint (event-local always;
      conversation review only when the window names exactly one tracked id).
- [x] Stamp unique provider work-item aliases from the conversation window
      onto proposed tasks (`acme/app#88`, Linear keys, Monday item ids) so a
      later captured-work matcher can hard-join. Deterministic copy only when
      one id is named.
- [x] When a meeting transcript never names the client **and** the container
      is silent, inherit a unique company/project hub from the owning
      calendar event or Saved Meeting's existing object links. Still refuse
      when two hubs are linked. Do not silently rewrite already-accepted
      unscoped tasks; propose a relationship or use memory repair.
- [x] Replace extract's time-ordered team dump (`RECENT_CONTEXT_LIMIT = 5`)
      with conversation-keyed / same-source context so facts that feed linked
      context are not five unrelated recent events.
- [x] Classify ingest by signal class rather than by OAuth app, following
      [`docs/relational-memory.md`](./docs/relational-memory.md) and
      [ADR 0016](./docs/adr/0016-ingest-signal-class-lives-on-the-envelope.md):
      communication may extract and review; structured captured work parses
      `objectMap` and may write coalesced approval-backed field changes;
      pulses persist, embed, and never originate; findings (Bugbot, CI,
      Sentry incidents) attach to the parent hub and do not mint sibling
      Timeline tasks. GitHub PRs and GitHub CI differ without a core
      `if (provider === "github")`. Linear/Monday item completion reuses the
      GitHub living-pending matcher. Opt-in live eval
      (`pnpm test:proposal-engine:live`) stays messy-first and is not CI.
- [ ] Ship the cross-source evidence pack north star in
      [`docs/cross-source-evidence.md`](./docs/cross-source-evidence.md) (rollout
      and copy; engine behavior is
      [`docs/relational-memory.md`](./docs/relational-memory.md)): a shared
      visibility-safe pack builder with policy-bound admission, deterministic
      ranking, exact per-item citations, conversation reviews and event-local
      paths that eventually cite multi-surface evidence, integrations remaining
      pack-eligible, evals/cost caps, and milestone-gated website copy. Follow
      [ADR 0014](./docs/adr/0014-cross-source-evidence-packs-use-policy-bound-related-evidence.md).
      First concrete slice: generic ingest webhook evidence combined with
      directly related conversation and provider events before proposal
      generation. The shared builder, Agent Ask adapter, and first generic
      webhook slice are code-complete behind
      `CROSS_SOURCE_EVIDENCE_MODE=off|shadow|enforced`; conversation and other
      event-local proposal migrations remain later milestones. This item stays
      open until those migrations plus the required shadow sample, live quality,
      monitoring, and explicit production-enforcement gates pass.

## Boards

- [ ] Strengthen board-agent behavior after real usage: board-scoped answers
      should cite evidence, distinguish accepted board state from pending
      suggestions, and expand direct board commands beyond the first
      approval-required add/update/remove card actions.

## Task Categories

- [x] Add LLM-assigned, user-overridable functional categories to task objects,
      plus an optional durable primary-project relation with project-page quick
      add, manual/AI linking, and project filtering. Include shared
      Tasks/Objects/Boards filters, category badges across work surfaces,
      guarded background classification, resumable backfill, deterministic tests,
      and an opt-in live eval harness.
- [ ] Complete task-category launch verification before enabling the production
      flags: rerun the agent eval, compiled-import, focused Playwright, and live
      120-case classifier gates; execute a staging dry-run/backfill and query-plan
      check; then measure the two-week dogfood and pilot thresholds for assignment
      latency, stale backlog, corrections, `other` rate, filter use, and incorrect
      project links.

## Agent Reliability

- [x] Expose the stateless Timeline team agent through opt-in outbound MCP keys,
      with scope-filtered discovery/calls, cited structured answers, proposal ID
      reporting, team-shared MCP evidence, bounded delegation, and the same
      proposal-only identity for unlinked trusted Telegram groups and Slack
      channels.
- [x] Ship the repository Codex plugin and marketplace entry with the hosted
      Timeline MCP connection, one general cited-workspace skill,
      standalone installation guidance, and links from public help and MCP setup.
- [x] Let reviewers revise unresolved approval proposals with plain-language
      feedback while preserving their operation, target, evidence, source
      records, and bounded revision history. Route chat corrections between
      pending proposal revision and approval-backed canonical object, board, or
      calendar edits.
- [x] Add richer per-tool observability for chat/retrieval turns: selected tool
      groups, omitted groups, retrieval recipe, result counts, top artifact refs,
      tool latency, and tool errors. Web chat now persists `tool_observability`
      on assistant turns with web-specific selection context, and non-browser
      `askAgent` callers can consume the same per-tool summary callback.
- [ ] Add a reusable agent eval harness with retrieval, dashboard chat,
      Slack/Telegram ask, background proposal, summary, and action/HITL suites
      over a compact seeded workspace. Current shared harness covers deterministic
      retrieval/tool traces, `SearchHit` fixtures, answer synthesis, non-browser
      `askAgent` model scripts, ask turn-observability capture, and dispatcher-level
      Slack/Telegram `/ask` surface evals that run the real `askAgent` pipeline,
      including fail-closed external presentation versus rich cited web output,
      dashboard chat route action/HITL tool-selection and persisted-observability
      evals, object-summary source-ref/visibility checks, plus a worker-level
      background proposal eval for visibility-safe conversation reviews.
- [ ] Finish advanced in-chat HITL follow-ups after dogfooding: persisted
      prepared action IDs for multi-step/high-risk actions, task-specific direct
      mutations, and remaining board-level operations such as board create,
      archive, and pin/unpin.
- [ ] Track retrieval freshness and index health by source kind, including
      stale embeddings after object/calendar/document/board updates and failed
      embedding/indexing jobs in job recovery or an admin health panel.

## Object Relationships

- [x] Add the first live Connected Work surface to object detail pages so
      source-backed open work, recent completed work, calendar events, and
      repeated people/object context appear before durable relationships are
      accepted.
- [x] Use supporting object evidence to suggest short-name/acronym duplicate
      object candidates such as `DFK` / `DFK Finland Oy`, while keeping bare
      three-letter name similarity below the proposal threshold.
- [x] Have the suggestion worker propose approval-backed `related` object
      relationships from relationship-shaped evidence, using extracted facts as
      candidate input and bounded raw/conversation context for verification.
- [x] Support relationship proposal bundles that create missing endpoint
      objects and the relationship together when each object independently
      qualifies as durable information, using bundle-local refs and ordered
      acceptance so `Accept all` creates endpoints before applying the link.
- [x] Surface accepted and pending relationships on both object detail pages,
      with relationship activity and evidence available nearby while cited
      per-edge explanations remain part of the later graph/mind-map slice.
- [x] Replace manual UUID relationship linking with object search/select in the
      object detail UI.
- [x] Collapse the generic `linked` relationship kind into `related`, migrate
      existing rows, remove `linked` from UI/tool inputs, and dedupe symmetric
      `related` relationships/proposals by sorted object pair while preserving
      direction for directional relationship kinds.
- [x] Expand Connected Work beyond the first slice with boards, pending
      approvals, documents, links, and captured files ordered by object-page
      usefulness.
- [x] Surface source-backed timeline context inside selected board cards and
      task side panels, while keeping the object detail page's event-level
      source browser consolidated under Evidence.
- [x] Add object-centered Memory Repair entry point on object detail pages that
      queues duplicate and low-signal archive cleanup focused on the selected
      object while preserving rejected-pair suppression.
- [x] Extend object-centered Memory Repair beyond duplicate cleanup so it can
      queue focused fact-backed relationship proposals without reoffering
      rejected edges.
- [x] Extend object-centered Memory Repair to create missing full-name
      person-object relationship bundles when connected evidence names a
      durable person not yet in object memory.
- [x] Keep object-page pending approval dependencies available for relationship
      proposals without surfacing unrelated bundle items, and render
      relationship/person rows with readable endpoint names instead of raw refs.
- [x] Strengthen relationship/person proposal generation from Connected Work so
      operationally useful task/company, decision/company, and person/company
      connections graduate into approval-backed object memory.
- [ ] After object relationships have real usage, design a graph/mind-map view
      with filters, density controls, and cited edge explanations. Do not ship
      the full graph in the first relationship implementation slice.

## Object Summaries

- [x] Ship persisted structured generated summaries, team-visible source
      packets, background refresh from canonical object/fact updates,
      object-page generation/retry, search and embedding updates, and chat
      retrieval consumption with underlying-source citations.
- [x] Finish remaining summary polish after dogfooding: indirect linked-task
      invalidation and deeper source-chip navigation for facts, relationships,
      object changes, notes, tasks, and timeline events.

## Calendar

### Recurrence

- [x] Add recurring event schema support: parent `rrule`, materialized
      occurrence rows on a recent-past/future rolling window, `recurring_parent_id`,
      `original_start_at`, and `is_exception`.
- [x] Add recurrence expansion worker and re-expansion semantics: "this event"
      marks an exception; "this and all future" deletes and re-expands
      non-exception children from the chosen occurrence onward.
- [x] Add recurring event editing UI with "this event", "this and all future",
      and "all events" modes, plus an exception badge on modified occurrences.
- [x] Extend approval-backed calendar suggestions so recurring events,
      tentative proposed slots, confirmed-slot updates, and occurrence-level
      reschedules materialize through the same approval path as tasks and
      objects.

### External Sync

- [ ] Add `connected_calendars`: per-user provider connection, encrypted OAuth
      or CalDAV credentials, selected calendars, privacy flag, sync cursor, last
      sync state, and default imported-event visibility.
- [ ] Add Google Calendar import: OAuth 2.0, incremental `syncToken`, and push
      notifications for near-real-time import.
- [ ] Add generic CalDAV import for iCloud, Fastmail, Nextcloud, Synology, and
      similar providers. Use polling because CalDAV has no universal push
      mechanism.
- [ ] Import external events as native `calendar_events` with provider source,
      `external_event_id` deduplication, and private visibility for private
      connected calendars.
- [ ] Preserve external deletions as soft-deleted calendar events with
      cancellation/tombstone raw-event metadata.
- [ ] Post-MVP: optionally push internal Timeline events to connected Google
      Calendar. Timeline remains authoritative; outbound push is best-effort.

### Reminders

- [ ] Add a stateless reminder worker on a 5-minute BullMQ repeatable. Query
      events whose reminders are due in the next window and fire notifications.
- [ ] Implement reminder cascade: team default
      `team_calendar_settings.default_reminder_minutes`, overridden by
      per-event `calendar_events.reminder_minutes`.
- [x] Add daily event digest per user. Delivery uses the shared messaging
      module, stores a dashboard-readable digest payload, and sends to workspace
      digest destinations (email by default; Slack/Telegram chats and member DMs
      are configurable). Email is only sent for useful activity or actionable
      context. Quiet windows are durably skipped, generated/sent rows are
      preserved across concurrent retries, local digest boundaries are
      daylight-saving-safe, per-user opt-out applies to personal email/DMs, and
      individual in-app notifications stay inbox-only.
- [ ] Extend overdue/missed alerts to calendar events past `start_at` with no
      attendance or completion signal.

## Backup And Operations

- [ ] Add a RustFS backup cron service on Railway: nightly `rclone sync` to
      Backblaze B2 or the chosen secondary object store.
- [ ] Add a Qdrant snapshot cron: nightly snapshot via the Qdrant API, uploaded
      to RustFS or B2.
- [ ] Confirm Railway Postgres backup retention and document the restore
      procedure.
- [ ] Run a full restore drill from backups to a scratch environment. Repeat
      quarterly.
- [ ] Build monitoring dashboards for Railway metrics, Sentry, worker queue
      depth, document processing failures, integration sync failures, meeting
      bot failures, and OpenRouter spend.

## Soft Launch

- [ ] Run a closed beta with 3-5 friendly teams and weekly feedback sessions.
- [ ] Instrument capture friction: time from "open app" to "event recorded."
      Target under 10 seconds for text and under 15 seconds for voice.
- [ ] Instrument agent answer quality with thumbs up/down. Target greater than
      85% positive.
- [ ] Instrument object usefulness: teams should manually or automatically
      update tracked objects every workday.
- [ ] Instrument document usefulness: internal-policy/document questions should
      return cited answers from the correct document version.
- [ ] Iterate on extraction prompts based on misses, then re-extract historical
      events as prompts improve.
- [x] Decide pricing model: per seat, per team, usage-based, or hybrid.
      V1: Free + PAYG (€0 platform) with native meters; optional Team (€49) /
      Business (€199) commitments; Enterprise custom. Polar MoR + shadow ledger.
- [x] Billing foundation: entitlements catalog, Polar products/meters (sandbox),
      `team_billing_*` ledger, `/pricing`, team Billing settings, webhook verify,
      shadow mode (`BILLING_CHARGES_ENABLED=false`). See ADR 0017.
- [x] Pricing UX: self-serve plan grid (no Enterprise column); gray Enterprise
      contact nudge; `/app/usage` tracking (meters plus folded infrastructure limits); Home/Usage/Billing upgrade nudges;
      Free hard-stop + spend-cap admission in billing scope (`release` included).
- [x] Wire native v1 meters at production call sites: Ask + Recall (existing),
      background LLM workers via ALS (`withAiMetering` in the OpenRouter wrappers),
      accepted unique sources at ingest, inbound/outbound email units, daily
      storage GB-month + member-day janitor, document write capacity.
      Agent turns, concurrent Recall bots, custom MCP servers, indexed chunks, and active-member
      ceilings are catalog capacity — not extra billed Polar meters. Extra
      owned workspaces claim at most one person-level Free grant.
- [x] Prepaid €10 top-up checkout on wallet-backed plans, auto-reload Polar checkout
      email when the wallet is at/below the threshold and remaining spend-cap
      headroom covers the full €10 product, cheapest-plan preview from gross native
      usage (informational, never auto-switch), Team/Business included-discount
      period reset (webhook + janitor; not every Polar retry). Stale Polar
      activations are ignored; canceled paid plans become restricted unless the
      team holds the Free grant.
- [x] Owner email reminders at spend-cap 50/75/90/100% and Free near-limit /
      exhaustion (once per threshold/period via `billing_usage_alert` Postmark
      template; in-app nudges remain).
- [ ] Enable Polar webhook with a real public URL; one shadow-billing month
      before `BILLING_CHARGES_ENABLED`. Auto-reload emails a Polar checkout URL
      (Polar has no silent saved-PM charge in v1).

## Standing Items

- [ ] Verify backups weekly and run restore drills quarterly.
- [ ] Monitor Qdrant RAM usage and plan a move to sharded or managed Qdrant
      before it becomes painful.
- [ ] Maintain an OpenRouter spend dashboard with per-feature cost tracking.
- [ ] Rotate API keys quarterly.
- [ ] Audit team isolation on every schema, integration, MCP, or data-access
      change.
- [ ] Test re-extraction and re-embedding procedures quarterly, even when not
      urgently needed.
- [ ] Keep Dockerfiles and `railway.json` in sync with deployed reality.
- [ ] Keep org-wide searchable embeddings complete for every team-scoped content
      surface: raw events, facts, entities, objects, object notes (discussion comments), object
      changes, documents, document chunks, meeting transcript chunks, meeting
      summaries, integration events, calendar events, and optionally chat
      messages. Verify with periodic row-count vs. Qdrant payload audits.
