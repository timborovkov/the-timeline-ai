# Design decisions

Historical rationale, including superseded decisions. For current requirements,
use [design.md](../../design.md), [components](components.md), and
[app screens](app.md) and [public pages](public.md). Add current requirements to those documents,
not to this log.

Archived from the earlier combined design document (labelled v3.30, with later
entries appended). Git history records subsequent changes to current contracts.

## Decisions log

| Date | Decision | Rationale |
| --- | --- | --- |
| 2026-05-25 | v2 Operational Archive | Made evidence and the timeline structurally visible. |
| 2026-06-01 | Expanded sidebar with collapsible rail | Preserved team context and dense navigation. |
| 2026-07-14 | v3 Quiet Archive | Human meaning now leads; technical evidence remains one click away. |
| 2026-07-14 | Switzer dominates ordinary UI | Removes terminal fatigue while retaining mono for recognizable data. |
| 2026-07-14 | Internal identifiers behind `TechnicalDetails` | Keeps auditability without leaking implementation detail into product copy. |
| 2026-07-14 | Attention + Ask Home | Makes the first screen action-oriented instead of duplicating navigation. |
| 2026-07-20 | Quiet, full-width Home with universal work pins | Removes redundant headings and card weight while letting people keep any important work item close. |
| 2026-07-27 | Cross-surface chat history badges | Makes Telegram and Slack transcripts recognizable without changing ordinary web sessions. |
| 2026-08-05 | Taste v2 landing evolution | Tightens the hero, varies section rhythm, and adds tactile states while preserving Quiet Archive tokens and IA. |
| 2026-08-05 | Searchable public help directory | Removes repeated guide grids and makes task-level help discoverable from one calm index. |
| 2026-08-12 | Editorial public acquisition system | Lets visitors watch evidence become chronology and a cited answer while the authenticated product remains Quiet Archive. |
| 2026-08-13 | Acme evidence narrative | Pairs recognizable work sources with chronology and replays each evidence diagram while it is in view. |
| 2026-08-13 | Connected public navigation | Gives every acquisition, integration, guide, help, and legal page a consistent route through the public site. |
| 2026-08-13 | Finalized public content system | Replaces concept notes and disconnected mock stories with a plain-language how-it-works overview, substantive walkthroughs, capability-aware connection guidance, and one disclosed Acme demo corpus. |
| 2026-08-13 | Unified public masthead and canvas | Makes the landing masthead and warm public palette identical across integrations, editorial, help, legal, and recovery routes without changing authenticated Quiet Archive. |
| 2026-08-13 | Subordinate integration title scale | Keeps long directory and provider headlines editorial without letting them crowd the explanation and evidence out of the first viewport. |
| 2026-08-13 | Plain-language how-it-works surface | Replaces the publication taxonomy and split-column guide template with one compact product explanation and readable walkthroughs. |
| 2026-08-14 | Clear how-it-works IA and hierarchy | Makes `/how-it-works` canonical, redirects `/record`, aligns the overview and walkthroughs with the integration acquisition grid, and keeps the three-step explanation in the first viewport. |
| 2026-08-14 | Legible integration acquisition paths | Adds provider-marked ingestion flow to the landing observatory, condenses the evidence-entry summary into capture and provider-sync paths, and widens the integration directory's card rail. |
| 2026-08-14 | Public capability truth | Separates hosted MCP, local-desktop MCP, and planned support while keeping phone navigation actions reachable. |
| 2026-08-14 | Customer-facing public language | Keeps review cadence, implementation state, indexing terms, and capability taxonomy in metadata while public pages explain concrete actions and availability. |
| 2026-08-15 | Evidence-backed public product story | Makes the working-history problem, deliberate capture boundary, cited-versus-unused evidence, Telegram entry point, inspectable answers, and human approval contract explicit across the landing and how-it-works journey. |
| 2026-08-16 | Unified workspace collection density | Replaces stacked form chrome and card grids with compact headers, one filter toolbar, 44px rows, semantic status glyphs, optimistic metadata triggers, and contextual selection without changing domain behavior. |
| 2026-08-17 | Feedback, preview, and remaining collection density | Locks viewport-sticky mutation toasts, Linear-style optimistic rows, view-only approval previews with live diffs, selection-bar bulk actions, title-first calendar chips, and collection rows for Connections, Team members, Meetings, and Approvals. |
| 2026-08-17 | Calendar object navigation | Edit event dialogs expose quiet linked-object title links; object Calendar sections link back to the focused event. |
| 2026-08-17 | Timeline event families | Gives Moments weighted story/record/pulse rows and All events a uniform compact log, with provider-agnostic classification. |
| 2026-08-17 | Linear timeline rows and original source | Drops duplicate rail icons and stacked row chrome; original payloads open from a collapsed inspector viewer. |
| 2026-08-17 | Inspector citation chips | Ask `[ev:…]` tokens stay off timeline rows and appear as copyable chips on inspector evidence items. |
| 2026-08-17 | Citation preview destinations | Citation popups name the matching workspace page, Timeline moment, and original payload instead of a generic full-page jump. |
| 2026-08-17 | Work overview and task canvas density | Puts pinned boards above the work queue, removes extra task-list gutters, matches the default list loading skeleton, puts Kanban/List on the search/filter row, and compacts task kanban cards to a clamped title plus one metadata row. |
| 2026-08-17 | Home open objects and inline queue edits | Adds open tasks, people, companies, projects, deals, and follow-ups to Home Attention, stops repeating “Task” on work-queue rows, and lets queue status, assignee, due date, and priority change inline. |
| 2026-08-17 | Quiet Home attention and dense recent moments | Collapses typed open-people/company/project rows into one open-objects count, drops the Attention and Recent moments headings, and replaces the Home timeline preview with denser title-only rows plus a clear Open timeline path. |
| 2026-08-17 | Team setup checklist on Home | Moves the team checklist under Ask, opens the full list for new members, and replaces the Reopen setup button with a quiet Team setup checklist toggle. |
| 2026-08-17 | Team setup loop and Home timeline links | Expands the checklist into a product-loop set, keeps the open header as quiet as the folded toggle, persists Hide, adds a folded chevron and off-Home chip, and turns Home moment titles into Timeline links with a quiet full-timeline path. |
| 2026-08-17 | Dense Ask session history | Reveals archive on hover/focus, shows relative last-activity age with a timestamp title, and uses a short centered hairline instead of a persistent trash column. |
| 2026-08-17 | Ask session search and title | Filters chat history from the session rail and shows the selected title beside Ask instead of a session count. |
| 2026-08-17 | Ask mobile session title | Reuses the resolved conversation title in the mobile session summary, including deep-linked chats outside the recent list. |
| 2026-08-17 | Quiet sidebar brand and fold control | Aligns the product mark with primary nav, sends it to Home, and replaces the boxed fold glyph with a lighter chevron. |
| 2026-08-17 | Linear-density object and task detail | Replaces boxed field grids and empty memory cards with list-row metadata, why-this-exists lead copy, ghost icon actions, and list-preserving peek navigation. |
| 2026-08-17 | Compact object and task detail rhythm | Tightens the object-page section stack to 16px, uses 20px titles, 32px property rows, 1.35 body leading, and keeps peek/page chrome on `--fg` / `--fg-muted` / `--fg-dim` / `--danger` without uppercase metadata. |
| 2026-08-17 | Tighter object and task detail rhythm | Compresses the object-page section stack to 8px, uses 18px titles, folds board placement into the header, and keeps body, labels, and quiet actions on one `--fg` / `--fg-muted` / `--fg-dim` set. |
| 2026-08-17 | Object and task detail rails | Puts the object Properties column and task peek on one `--surface` hairline panel so they lift off `--bg` in light and dark without nested field cards. |
| 2026-08-17 | Board kanban lane control | Stops repeating the current lane name on kanban and grouped list cards, keeps a quiet Move trigger, and leaves lane names on table and card-detail. |
| 2026-08-17 | Board canvas and compact cards | Makes list and table boards full-bleed like Tasks, puts next step under the kanban title, removes the on-card Move row, and leaves lane names on table and card-detail. |
| 2026-08-17 | Board next step and row alignment | Treats next step as a title subtitle instead of a table column, and vertically centers board checkboxes. |
| 2026-08-17 | Collection toolbar view and add | Puts board view toggles on the search/filter row with Tasks, and turns Add item into a compact popover action. |
| 2026-08-17 | Collection loading skeletons | Matches collection loading placeholders to the live toolbar row, compact add control, view-aware board/task canvases, and flat collection rows. |
| 2026-08-17 | Action toasts and shared copy controls | Replaces inline Saving/Saved/error chips for mutations with one optimistic toast lifecycle, compensating Undo, and a single CopyButton for clipboard fields. |
| 2026-08-18 | Shared progress toasts and redirect notices | Folds job-recovery batch progress into `notifyProgress` and sends reconciliation queue results through the toast channel. |
| 2026-08-18 | Unify mutation toasts on notifyAction | Folds #359 `toastMutation` call sites onto the shared `notifyAction` lifecycle after merging collection density and floating Ask. |
| 2026-08-17 | Infinite scroll with Linear timeline rows | Replaces Load more and numbered pagers with sentinel paging and virtualized rows; Timeline keeps Linear archive rows, sticky dates under the toolbar, and no inventory chip. |
| 2026-08-17 | Digest status, window range, and linked lists | Replaces Product status with Status, shows the covering time range, lists tasks/objects/calendar with existing Home and email type, and omits empty groups including source inventories. |
| 2026-08-17 | Digest date header, footer window, and activity strip | Puts the digest date in the header, moves the covering range to footer metadata, and turns web activity into a Home-style mono lime count strip. |
| 2026-08-17 | Collection chrome with infinite-scroll counts | Keeps compact board/task/object chrome after merging infinite-scroll counts, virtualized kanban lanes, digest briefings, and Timeline’s toolbar-only Linear feed. |
| 2026-08-17 | 7-day job recovery queue | Makes Home and Background jobs share one recent failed/stuck count, hides older backlog from attention, and keeps unprocessed inventory in Advanced tools. |
| 2026-08-17 | Jobs recovery dismiss at scale | Makes older-job dismiss a batch write with progress toasts, windows the 7-day snapshot behind Load more, and keeps retry/dismiss on the shared `notifyAction` path. |
| 2026-08-17 | Dense jobs recovery rows | Drops per-row Technical details so the admin queue is status, label, time, and retry/dismiss. |
| 2026-08-17 | Job recovery row overflow | Renames the page Job recovery, moves per-row retry/dismiss into the overflow menu, and keeps IDs plus raw errors in the row hover title. |
| 2026-08-17 | Quiet reconciliation dashboard | Drops the How it works primer, release-gate banner, and stat cards, and puts coverage actions on a hinted toolbar above recent rows. |
| 2026-08-17 | Reconciliation header and column titles | Drops access and team from the metadata row, removes Recently reconciled, and uses sentence-case Recent clusters / Recent outputs titles. |
| 2026-08-17 | Job recovery infinite scroll | Pages the 7-day snapshot and finished archive with the shared InfiniteScroll sentinel instead of a Load more button. |
| 2026-08-17 | Quiet job recovery header | Drops the access, team, last-7-days, and older-hidden metadata row so the page leads with title and subtitle. |
| 2026-08-17 | Quiet reconciliation header | Drops the checked / needs repair / updated metadata row so Reconciliation also leads with title and subtitle. |
| 2026-08-17 | Quiet admin Advanced tools | Replaces job-recovery stat cards and reconciliation uppercase/badge chrome with sentence-case headings and dense count or history rows. |
| 2026-08-18 | Collection chrome with quiet job recovery | Keeps compact board/task/object chrome after merging Home checklist hydration, React Doctor splits, quiet Job recovery, and quiet Reconciliation. |
| 2026-08-17 | Floating Ask | Replaces per-page Ask-about buttons with a context-aware float, keeps one thread on close, and shows linked context badges in full Ask. |
| 2026-08-17 | Floating Ask context names | Names the float from the selected timeline, calendar, task, search, or folder item, and makes the mobile sheet modal while desktop stays non-modal. |
| 2026-08-17 | Quiet floating Ask header | Keeps the shortcut on the launcher and drops the header shortcut plus earlier-count line. |
| 2026-08-18 | Collection chrome named children | Passes CollectionRow, CollectionToolbar, EditableMetadata, and PageHeader chrome through named children; Title/Context `title` carries hover IDs and errors. |
| 2026-08-17 | Linear collection rows | Collection rows use a full-width bottom hairline only. Pinned and Approvals drop unlabeled toolbar counts. |
| 2026-08-18 | Approvals select-all | Restores bulk review without a persistent Accept-all bar: a visible Select-all checkbox for loaded proposals, plus the same control on multi-item bundle headers. |
| 2026-08-18 | Timeline search and continued paging | Puts Search timeline on the archive toolbar, keeps source presets visible, and re-observes the infinite-scroll sentinel after each page so virtualized rows keep loading. |
| 2026-08-18 | RSC collection toolbar slots | CollectionToolbar compound slots render a `data-collection-slot` marker so search/filters/view/actions survive the RSC client boundary. |
| 2026-08-19 | Collection chrome with timeline search | Keeps compact board/task/object chrome after merging Linear collection rows, named toolbar slots, action toasts, floating Ask, and Timeline search paging. |
| 2026-08-19 | Board kanban toast-only metadata | Restores EditableMetadata slots after the toolbar-slot merge and drops leftover Saving/Saved chrome so board card mutations stay on notifyAction. |
| 2026-08-19 | Object and task detail rails | Puts the object Properties column and task peek on one `--surface` hairline panel after merging collection chrome, floating Ask, and `notifyAction`. |
| 2026-08-19 | Remaining settings and directory density | Aligns Team settings, Connections, Meetings, Calendar, Slack, Telegram, and remaining timestamps with compact collection rows, NativeSelect, quiet icon actions, and relative age plus hover datetime. |
| 2026-08-19 | Kanban card alignment and saved-meeting editor | Aligns board/task kanban title and metadata on one left edge with compact chips and hairline lanes, and makes Meetings Edit details open the editor instead of a nested Edit saved meeting control. |
| 2026-08-19 | Board list replaces table; task kanban skeletons | Drops the legacy board Table spreadsheet so boards match Tasks with Kanban and grouped List, maps `?view=table` to list, and pages task kanban with card skeletons instead of flickering Loading more labels. |
| 2026-08-19 | Shared collection empty states | Replaces one-off empty copy and ad-hoc wells with `EmptyState`: quiet dim icon, title, explanation, and create/recover actions only when the person can act. |
| 2026-08-19 | Timeline flush sticky toolbar | Drops main top padding on Timeline (`flush-top`) so the sticky filter bar and `top-11` date labels sit under the 48px header without a negative `top`. |
| 2026-08-19 | Standardized personal pins | One icon pin with Pin to Home tooltip, mixed Home and Work previews, list pin glyphs, and About labels for Ask object bindings. |
| 2026-08-19 | Board add-item people and companies | Add item keeps person and company type filters visible and searches beyond a recency window of recent tasks. |
| 2026-08-19 | Object discussions | Replaces object custom notes with a Linear-style activity + comments thread, @mentions, The Timeline Bot pings, and quiet comment counts. |
| 2026-08-19 | Quiet list bounds | Replaces “No more matching …” copy with a short centered hairline. |
| 2026-08-20 | Explicit MCP agent permission | Keeps model spend, team MCP access, and proposal authority default-off and legible at key creation while preserving cited machine-readable answers. |
| 2026-08-20 | Copy-ready agent setup | Gives public Help one recommended install prompt, narrower skill and MCP paths, searchable setup details, and explicit secret and authority boundaries. |
| 2026-08-21 | Evidence-gated Trust and legal acceptance | Adds a candid public Trust center, detailed legal surfaces, and a blocking per-user versioned acceptance path without presenting external account settings or future certifications as verified. |
| 2026-08-21 | Privacy and analytics boundary | Adds an exact Cookies and similar technologies notice, separates notice from consent, and defines public-only optional browser analytics without weakening identifier-free aggregate traffic counts or private workspace routes. |
| 2026-08-21 | Evidence-flow acquisition story | Reframes Timeline as AI team memory, introduces the reusable evidence-to-workspace-to-assistant explainer, and adds three substantive outcome-led solution pages. |
| 2026-08-21 | Restored compact observatory | Restores the six-source orbit and official center mark, makes packets reuse their drawn curves, and adds only working-record and cited-answer outcomes after the core. |
| 2026-08-21 | Dedicated animated platform flow | Keeps the compact observatory on home, moves the grouped full-loop explainer to `/how-it-works`, and uses exact-track signal packets plus per-stage viewport activation to make causality visible without excessive cards or page height. |
| 2026-08-21 | Usage nav and billing nudges | Adds Manage → Usage, keeps Enterprise off the public plan grid as a gray contact nudge, and surfaces quiet spend-cap / Free-allowance nudges on Home, Usage, and Billing. |
| 2026-08-21 | Sidebar plan usage meter | Puts plan name, usage progress, and overage under Help in the app sidebar (and mobile nav), linking to Billing or Usage. |
| 2026-08-21 | Free CTA honesty | Header CTA is `Start free`; landing and sign-up say free / no card; upgrade nudges link to `/pricing`. |
| 2026-08-21 | Privacy-conscious analytics and support | Implements equal-choice public analytics consent and withdrawal, personless surface-request totals, HMAC-pseudonymous product events, a private support-context boundary, safe public bug routing, and aligned desktop/mobile help actions. |
| 2026-08-22 | Usage plan limits | Usage and Billing show live used/limit for Ask turns, concurrent meeting notetakers, custom MCP servers, documents, storage, indexed chunks, and member seats — not Polar meters. |
| 2026-08-24 | Folded infrastructure limits | Usage, Billing, and `/pricing` keep billed meters in the default view. Plan capacity ceilings sit in a closed **Infrastructure limits** disclosure. |
| 2026-08-26 | Installed-app splash | Adds per-device iOS startup images of the existing mark on `#0a0e0d`, matching the Android Chrome splash from the web app manifest. |
| 2026-08-28 | Home team email field | Surfaces the inbound address on Home below pinned work as one readonly copyable field (`#team-email`), and keeps the same control on Team → Email for every member. |
| 2026-10-24 | Inbound placeholder notice | Team → Email flags leftover `@inbound.invalid` addresses in muted helper copy so operators can see mail will not be captured until inbound email is configured. |
| 2026-08-28 | Object Properties rail polish | Widens the object rail to `20rem`, shares one labeled field chrome across Contact/Details/Properties, keeps status icons toned with quiet value text, and drops empty contact chrome plus boxed add forms. |
| 2026-08-28 | Object detail list folds | Evidence, Facts, Documents, and other Connected work lists preview three rows then fold behind `Show N more`, with hairline dividers and tighter evidence clamps. |
| 2026-08-28 | Object detail typography | Shares `object-detail-type` roles: 13px semibold section titles, medium 14px row titles, Commit Mono counts/timestamps, and medium rail labels. |
| 2026-10-30 | Polar promo codes | Change plan includes an optional promo field with inline eligibility/provider errors. An active assigned team discount disables the field and explains precedence; discounts never stack. Invoice previews remain local estimates before Polar campaign savings. |
| 2026-10-23 | Quiet customer billing | Team Billing separates remaining benefits, recorded usage charges, recurring fee, and monthly spend cap. Usage is a meter table. Cap, payment, and comp states are one banner each. Members only see a limit notice. Platform admin billing stays dense. |
