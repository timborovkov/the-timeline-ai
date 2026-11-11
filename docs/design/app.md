# Application design patterns

Dashboard collections share the same title, context, section-band, and row
boundary treatment. Detail views lead with a summary and editable properties;
settings group related controls with short supporting text. Full source material
and secondary context belong in disclosures with clear ways to open them.

Collection indexes keep a bounded inner content width and shared responsive
gutters. Section backgrounds and row separators extend to the main pane edges. Work’s empty Boards group is a compact inline prompt with Create board,
so the work queue remains near the top even before a team creates its first board.

### Home

Home does not repeat its navigation label as a visible page title. It starts
with a quiet Capture action and the same compact, icon-only-send Ask composer
used in chat. The team setup checklist is Home onboarding. For a member who
has not hidden it, the list sits open directly under Ask with the same small
quiet label used when it is folded: completed steps, the current step with
guidance and one outline action, later incomplete steps as underlined links,
and a text Hide control. Hide persists per member even when nothing is
complete, including after new steps appear. After a member hides it, the same
slot keeps a quiet “Team setup checklist” text toggle with a tiny chevron and
the remaining count. Off Home, a matching quiet header chip returns to the
panel until the member hides it or every step is done. The account menu also
reopens it. The checklist teaches the product loop (capture, people, sources,
ask, meetings, trust memory, stay in the loop) rather than enumerating every
work surface.

New teams start in a focused setup shell for Welcome and Bring something real
(processing and failed website-scan stay in that shell). After the first capture,
guided Ask, Approvals, and Go live use the real app chrome with a slim Getting
started strip (Capture, Ask, Approve, Go live). Fresh guided Ask includes the visible
starter capture in its context; guided Approvals scopes rows and counts to that
capture, including pagination. First-record suggestions use the same proposal and
supporting-evidence visibility checks as the approval queue. Empty first-record and
guided Approvals views offer Check for suggestions so asynchronously generated
proposals can be discovered without reloading the page. Home never shows that strip.
Skipping lands on an empty Home with the same checklist and next-step copy, not a
sample workspace. Website scan is an available chooser card backed by Firecrawl. Work-style chips describe how the team works, never
headcount, and only reorder suggestions plus the recommended Go live channel.

Website scan asks “Who is this website about?” with “Our team or company” selected
by default and “A client, partner or another company” as the alternative. Both use
Company records; the own-team choice also suggests cited people and projects.
The user confirms permission to submit the site; only public pages are read.
Source documents are saved as evidence, while canonical records require approval.

Billing setup is an optional-on-Free checklist item linking owners/admins to plan
selection; other members are directed to team owners. It completes from an active
subscription or active comp arrangement, without a manual checkoff. Its guidance
and CTA remain visible independently of the next incomplete product step; it never
blocks product onboarding progression. Restricted
Free teams see the specific verification or grant issue with its resolution action.

Attention has no visible heading; the region is named for
assistive tech only.
It shows only non-zero groups: pending approvals, overdue work, open tasks,
open objects, recoverable jobs, and connection issues. Overdue work stays the
danger row into the work queue. Open tasks stay their own row into Tasks. Open
objects is one generic count for people, companies, projects, deals, and
follow-ups, linking to the Objects list rather than typed filters or dumping
those records onto Home. “You’re caught up” replaces empty dashboard grids
when every group is zero. Pinned work, the team inbound email as one readonly
copyable field (`#team-email`) with a quiet link to Team → Email settings,
digest, and a dense recent-moments scan follow as full-width sections without
duplicating Timeline or Connections. These sections use spacing between groups and hairlines between dense rows,
following the boundary rules in [the design system](../../design.md#core-rules).

The latest digest stays folded until opened. Its summary and section bodies are
readable prose, not inventories of pull requests or IDs. The generator bans
pull-request numbers, commit hashes, CI run IDs, ticket keys, and object
UUIDs: it scrubs them from the briefing packet, retries a draft that still
lists them, and discards that draft if the rewrite fails. Narrative sections
use Highlights, Status, Completed, In progress, Decisions, Risks, and
Follow-ups; Status is the current state of work, not a product-specific label.
Empty sections and empty task, object, or calendar groups are omitted. The
header shows the digest date; the covering time range stays footer metadata.
Activity is a compact count strip using the same mono lime numbers as Home
Attention, and is hidden when every count is zero. Task, object, and
calendar blocks are ordinary linked lists: newly created or completed tasks,
new non-task objects, calendar events that fell in the digest window, and
upcoming events. Titles use the same underlined Home treatment in the app and
the same lime underlined links as other mail. Repeating calendar series
collapse to one upcoming entry. Titles open the object or the specific calendar
event on the dashboard. Work → Digests lists generated days as collapsed rows
so a teammate can open a specific day. Quiet windows stay skipped and are not
emailed; upcoming calendar alone does not make an inactive team look busy.

Pinned work is one personal, mixed collection. It may contain canonical
objects (including tasks, projects, deals, people, and object-type documents),
boards, library documents and captured files, meetings and saved meetings,
calendar events, and displayed timeline moments. Recurring calendar events pin
the series; timeline pins preserve the grouped moment rather than an individual
raw event.

Home previews at most six currently available pins as lightweight, full-width
rows with a type icon, title, one context line, and overflow menu. Hidden,
archived, or temporarily inaccessible targets do not become placeholders and
do not consume a preview slot. Home never offers reordering; its Manage action
opens Work → Pinned. Work overview repeats that same mixed preview (heading
**Pinned**, omitted when empty) above a separate **Boards** list of team boards
and the work queue. Overview board rows use the same overflow **Pin to Home**
control and quiet pin glyph as the Boards index. Pins are personal shortcuts, not a team-shared board set.

Home recent moments have no visible heading. They show up to eight dense rows
of time, source, and an underlined title, with quiet non-sticky date labels
and no preview, evidence chip, impact strip, transcript link, or timeline
rail. Each row opens Timeline at that moment with the inspector showing the
event. A quiet “Go to the full timeline” text link always follows for the
rest of the archive.

### Timeline

Timeline is the strongest archive expression. Chrome is a sticky
`CollectionToolbar` under the 48px shell header. The row includes **Search
timeline**, a Filters trigger (source, origin, author, impact, and dates),
source presets, and **Moments** / **All events** as the view control. Search
submits on Enter and opens global search with the current source and date
filters. Moments group related activity and give rows
different visual weight. All events is a uniform compact log of every captured
source event. The labels and the row density should make the difference
obvious without a lecture. Timeline has no inventory chip; Moments versus All
events is the page mode.

Each Moments row is a Linear-style collection row: time, one source icon, a
title of up to two lines, and at most one muted source/actor/context line.
Source body previews belong in the inspector, not the collection row. Do not duplicate the
icon on a rail node, and do not stack source, actor, title, and preview as
separate competing headings. Stories and records share that same skeleton;
pulses stay one muted line. Impact on the row is omitted; the inspector shows
workspace consequences, structured facts, a matching `[ev:…]` citation chip per
source evidence item, and a collapsed Original source
disclosure. Attached files link to Documents. Sticky date bands and row boundaries extend to the main-pane edges while their
content stays bounded. The date offset follows the measured toolbar height,
including wrapped controls and expanded filters. Infinite scroll retains
virtualized rows. The default view ends at the current instant so
materialized calendar occurrences do not displace recent work. Upcoming context
is an explicit seven-day view; the Calendar surface owns the complete future
schedule. Compact Home moments are a denser scan of the same formatter: time,
source, and title only, linking into this surface. Timeline pin and overflow
actions stay visible without hover, using the shared item-action primitives.

The inspector uses one quiet surface per source, sentence-case metadata, and
three initial evidence items. Show older evidence reveals the next batch with
its own visibility, audio, and removal controls. Long excerpts show four lines
with View full evidence opening the complete text; Original source remains
available. Repeated source previews are omitted above the evidence section.
Related objects show their identity and a source-count disclosure instead of
nested expanded evidence boxes. The shared inspector header allows a bounded
multiline title and retains keyboard/focus behavior.

### Ask

Ask uses a standard sans header. Human/assistant role labels are quiet 12px
text; inline citations are mono lime superscripts, not raw chips. Tool
execution is collapsed. Ask object
bindings always have a human label and read **About {name}**, not Pin. Prompts
handed off from Home are stored
briefly in team-scoped session storage and never in the URL.

The desktop session list stays dense: last-activity age under each title in
mono 11px, a centered 60% hairline between rows, and archive revealed on row
hover or keyboard focus. Hovering the relative age shows the localized
timestamp. A search field under New chat filters the visible history. New chat
uses the shared ghost `Button`. Touch session lists keep archive visible.

The Ask heading stays on one row. When a conversation is selected, its title
sits beside the heading as truncated muted text. The mobile session summary
uses that same resolved title, including deep-linked chats outside the recent
list. Session counts do not appear in the header.

A context-aware floating Ask sits on every authenticated page except Home and
the full Ask route. It is a quiet icon button in the bottom-right corner, with
`⌘J` / `Ctrl+J` as the shortcut on the launcher. Desktop opens a non-modal
panel over the page so the board, object, or document stays usable. Mobile
opens a modal bottom sheet with a dimmed backdrop. The header shows only the
current view label — the selected item name when a list page has one,
otherwise the route label — plus New, full Ask, and close. Closing keeps the
thread; New starts a blank one. The agent receives the current view first and
a capped trail of earlier views from the same conversation. Full Ask shows
those views as compact linked badges on the conversation.

The web Ask surface is the rich research view: answers may be thorough and use
sections, lists, or tables, while inline citations remain inspectable numbered
markers. The answer card keeps the named destination (transcript, calendar,
documents, Timeline moment) rather than a single unlabeled page jump. The
inspector chip dialog still reuses the original-source viewer. External chat delivery uses the same retrieval and grounding but a
compact plain-text presentation, normally one short paragraph or three to five
bullets. Telegram, Slack, and future external chat providers never expose
Timeline citation syntax, raw-event IDs, or generic source footers. Explicit
requests for more detail may expand within the provider-safe reply limit.
Outbound MCP agent calls use a third compact profile: citations remain inline
for machine verification, while the response also exposes parsed artifact
references and proposal IDs. Key creation keeps agent access visibly default-off
and warns about model usage, enabled team MCP tools and their possible external
side effects, and human-reviewed proposals.

### Work and settings

Work pages share one subnavigation and lead with the task at hand, not a grid of
links. Work → Digests is the day-by-day archive of those briefings. Work overview
leads with mixed personal pins (same rows as Home), then team boards, then the
work queue so saved work stays in reach before due and assigned items. Tasks default to the grouped list; the list table
is full-bleed inside the work canvas, without extra page gutters around the rows.
Kanban/List view controls sit on the CollectionToolbar row with search and
filters, not on a second strip. Board kanban/list uses the same toolbar
slot. Add item is a compact toolbar action that opens a popover, not a
full-width boxed header. Existing-object search keeps every object type
filter available, including people and companies, and looks past the first
preloaded window so a pipeline is not limited to recent tasks. Loading placeholders match the live CollectionToolbar
(search, optional count, Filters, view toggle, and compact add on one row) and
the requested view: Tasks default to list, boards default to kanban, and
list/kanban each have a matching skeleton. Timeline loading uses the same
toolbar row without a page header or inventory chip, then Linear feed rows.
Collection pages load as flat rows, not boxed card grids. Objects New object and
Boards Create board use the same compact toolbar/header action as Add item, not a
filled primary chip. Kanban cards stay compact: a clamped title plus one
metadata row, with no redundant type label. Curated boards use the same
full-bleed work canvas in kanban and grouped list — no boxed inner
container around the collection. Board kanban cards stay compact: a clamped
title, optional next-step line directly under the title, and one metadata row.
Kanban lanes use a hairline divider, not boxed column chrome. Pipeline boards
keep a readable lane min-width and scroll horizontally when the columns do not
fit, including 1280 and 1440 canvases; they do not clip the last lanes. Card title and
metadata share the same left edge: compact 20px chips, no extra type/metadata
padding, and no wrapping priority row. The drag handle sits with the card
actions on the right. Cards have no Move control; the drag handle is the
on-card move path (Space or Enter, then arrow keys), and opening the card is
the keyboard alternative. Task kanban paging uses card skeletons in columns
that already have cards; empty lanes stay empty instead of flashing
Loading more labels.
Grouped board list does not repeat the current lane name or add a Move row. Next
step is the board-local immediate action on that card, not an object description
and not a spreadsheet column. It sits under the title in kanban and list, and
is edited in the open card. Card-detail keeps the lane name because that view
is not already organized by column. Board list checkboxes
stay vertically centered with the row. Do not style board lanes as badges. Team
settings render one URL-selected section at a time. Field validation stays on
the edited form; pending, success, and server failures use the shared action
toast. Member, object, source, and artifact labels never fall back to UUIDs.
Team → General keeps identity as a form (rename for admins) plus two readonly
copyable support fields — team id and slug — with spacing between sections
and no nested cards.

Team → Members is a collection: compact header, `CollectionRow` members with
visible role and quiet actions, not a padded card list. Role changes save on
select. Remove, resend, and revoke are tooltiped icon buttons. Invite, pending,
removed, and export lists use the same rows. Other settings sections stay
forms, with spacing between sections, 12px muted labels, compact `sm`
outline saves, and at most one filled primary action per view (Rename, Create
invite, Start export). Select and checkbox preferences may save immediately.

Connections is a flagship settings directory with Sources, Agent tools, and
Developer as real routes (`/app/connections/sources`,
`/app/connections/agent-tools`, `/app/connections/developer`) — the same
hairline tab chrome as Meetings. `/app/connections` redirects to Sources.
Inbound Email sits in its own quiet Inbox section at the top of Sources because
it is Timeline’s team inbox, not a third-party provider. Telegram, Slack, and
the remaining providers follow as `CollectionGroup` + `CollectionRow` (white
padded logo tile, name, one status — Connected, Syncing for team, Needs
attention, or Not connected — and one primary action). They are not bordered
`p-4` cards. Documents uploads and meeting notetakers stay on their own sidebar
pages, not on Connections. Clicking a source row opens a details sheet with
that provider’s accounts, resource picker (repos, projects, channels, folders),
default team visibility, team-sync activation, matching MCP server, recent
activity, and disconnect. Telegram setup (bot link tokens, group bindings,
linked users) and inbound Email (team address and list-style allowed senders)
live in those sheets. A Drive folder picker replaces the generic checkbox list
inside that resource-picker slot: one account header with the share count and
Save sharing control, short user-facing copy (no webhook or API jargon), a
full-width search field, and a single checkbox list without nested cards or
orphan checkboxes. Provider logos stay on white tiles. Available providers sit below as a Connect /
Set up list. A quiet search on the tab chrome filters the open section. Agent
tools holds compact rows for Agent MCP servers and Connect your agent;
local-only and unroutable catalog entries such as Figma sit in Coming soon with
no Connect action. Developer holds ingest webhooks, integration audit, and job
recovery.
Connect your agent is a client picker plus one install path: official vendor
marks on white tiles, a CollectionRow list, and a single selected setup. Add
memory, Timeline skill, connected grants, and static keys stay in one closed
hairline disclosure stack. Admin grant rows show the consenting member next to
the client so Revoke is unambiguous. Do not nest cards, stack `border-y`
sections, or invent connector logos.
Those tools open sheets or their existing admin pages — they are not an
expanded dump. Sheets close with Escape and trap focus. There is no separate
Integrations row, and no provider is listed twice. Status uses
`CollectionStatus` or readable sentence-case text, not uppercase chips. Provider
logos always sit on a white padded rounded tile. Fragment links such as
`/app/connections/sources#email`, `/app/connections/agent-tools#agent-mcp`, and
`/app/connections/developer#webhooks` open the matching tab and sheet. Legacy
`/app/sources` (including hashes), `/app/team/integrations`, and
`/app/team/telegram` redirect to the matching Connections route and sheet.

Meetings keep the collection header and rows. One primary header action opens
a focus-managed dialog: **Invite notetaker** on Captures, **Save a meeting** on
Saved. Creation forms close on success and remain open on errors. Empty
collections omit search/filter controls and redundant section headings; active
filters always keep their controls and clear-filter recovery. The empty state
explains the next step without duplicating the header action. The Saved tab
lists saved meeting links only; captures stay on Captures. Saved meeting edit
is one closed **Edit details** disclosure that opens the editor, never a nested
second “Edit saved meeting” control. Join, archive, and skip are tooltiped icon
buttons. Capture times use relative age with a timestamp tooltip. Meeting
mutations use the shared toast contract.

### Calendar

Month and week cells are title-first. Time is a muted prefix that does not
share the truncated title string. Tentative and recurring are a left rail or
tiny icon, never the word “Tentative” or a pencil on the chip. Month cells
show at most three events, then `+N more`, which opens day view for that
date. Selected or editing events keep a quiet ring. Chips use `text-[11px]`
and tight padding so names remain readable in a seven-column grid. Week
numbers belong on the week column, not inside every month cell.

The Edit event dialog stays a calendar-event editor. When the event is linked
to workspace objects, those objects appear as quiet title links under
**Linked objects**, never as a large Open button. Object Calendar sections
link the other way to the focused calendar event. Subscription create/last-used
times use relative age with a timestamp tooltip. Event dialog selects use
`NativeSelect`.

Job recovery is an admin-only queue, not a processing inventory.
Members who open `/app/team/jobs` see an Admins-only empty state. Home
“recoverable jobs” and the jobs page share the same 7-day failed/stuck count,
and only admins see that Home link. The page uses a sentence-case `PageHeader`
titled Job recovery, with Team breadcrumbs like other team drill-downs. The
header is the title and the 7-day subtitle; it has no access, team, or count
metadata row. It groups Failed then Stuck. Kind filters appear
only when more than one job kind is present. Rows show status, label, and
relative time. Retry and dismiss live in the row overflow menu; bulk Retry
failed and Dismiss all stay on the toolbar. Hovering a row’s label or time
shows the formatted timestamp, job ID, artifact UUID, and raw provider error
when one exists. Jobs older than 7 days are hidden from attention; admins can
dismiss them in bulk, and the action keeps going with a loading toast until the
hidden count is cleared. The visible 7-day list pages through the current
snapshot with the shared infinite-scroll sentinel. Retry and dismiss
use the shared action-toast lifecycle (`notifyAction`), including mapped
sentence-like partial errors. Bulk older-job dismiss uses `notifyProgress` so
one loading toast can update in place. Unprocessed
backlog counts (events still waiting for extraction or embedding) and the
conversation-suggestion backfill stay inside closed Advanced tools and never
use “needs attention” language. That fold lists backlog counts as dense rows,
not a card grid, and shows finished jobs as status, label, and time.

Reconciliation is an admin-only health view, not a retry queue. Members who
open `/app/team/reconciliation` see an Admins-only empty state. The page
explains itself in the header. The header is the title and subtitle; it has no
access, team, or coverage-count metadata row. Sources that still need evidence
appear as dense rows, then a Check coverage / Preview repair toolbar with hover
hints, then Recent clusters and Recent outputs as ordinary section titles. There
is no How it works primer,
Recently reconciled heading, release-gate banner, or stat-card strip.
Evidence-by-source counts, manual UUID reconcile, and run history stay inside
closed Advanced tools. That fold uses the same quiet disclosure, sentence-case
section titles, and dense count/history rows as the rest of the page — not
uppercase eyebrows, badge clouds, or a metric strip. Cluster IDs, output IDs, raw-event IDs, and raw enum keys
stay in the row hover title. Cluster output JSON copy lives in the row overflow
menu. Cluster detail uses Team / Reconciliation breadcrumbs without a second
back link; Reconcile and View workspace item sit in the header.

Work → Pinned is the complete pin-management surface. It is a single
side-to-side Linear list with infinite scroll, virtualization, and no inventory
chip. An empty All or filter list uses shared `EmptyState` with title
**No pins yet**. Filters are All, Objects, Boards, Documents, Meetings, Calendar, and
Timeline. Reordering is available only under All so filtered adjacency never
changes the mixed global order implicitly.
Drag reorder has equivalent keyboard actions for move up, down, top, and
bottom; keyboard moves announce their result through a polite live region.

Detail pages, peeks, board headers, document headers, meeting headers, and
calendar edit dialogs use one visible icon-only pin control: the `Pin` glyph,
muted when off and signal-filled when on, with `aria-pressed` and a hover
tooltip **Pin to Home** / **Unpin from Home**. Never use `PinOff`, a bordered
Pin/Unpin chip, or a duplicate pin item in the same overflow menu. Dense rows,
cards, calendar entries, timeline moments, work-queue object rows, and
global-search results keep the action inside their overflow menu as **Pin to
Home** / **Unpin from Home**, whose accessible label includes the target title.
Already-pinned dense rows show a quiet filled pin glyph beside overflow; it is
not a second toggle. Controls update optimistically, retain focus, and restore
the prior state when a mutation fails. The shared action toast is the busy,
success (**Pinned to Home** / **Unpinned**), and error signal, with Undo.

Item-owned actions stay inside the row, card, inspector evidence block, or
detail region for the item they affect. Use the shared row placement for dense
items and the shared footer placement for cards that need persistent controls;
both wrap without horizontal scrolling at 320 px and at 200% zoom. Every action
group has an accessible label naming its target. Keep the primary workflow
action visible. For three or more independent actions, keep that primary action
visible and move edit/state, utility, and destructive actions into a
target-labeled overflow menu, in that order. Destructive actions never become
the visible primary action when a safer workflow action exists. Coordinated
decision sets such as Accept, Change, and Reject remain inline because they are
one workflow, not independent commands. Overflow menus support keyboard
navigation, close on Escape, and restore focus to their trigger.

Collection toolbars, page-level actions, form Save/Cancel controls, modal
footers, field-level table editors, and visible detail-page pin controls
remain in their established ownership zones. Item actions are always visible
or reachable without hover; hidden or paginated items expose no detached or
orphaned controls.

Task category is a compact secondary label in the task/type line, subordinate
to title, status, assignee, due date, and priority. Pending and failed states
use readable text, never color alone. Project is a distinct named relation.
Task list rows show it once, as the editable project control, not also as a
static context string. Kanban cards keep that same editable control in the
compact metadata row rather than a colored tag or a second project label.
Task peeks and object pages reuse the same `EditableMetadata` triggers as the
list rows. Archived tasks replace project and category controls with a short
instruction to unarchive the task first.

### Object and task detail

Task list selection opens a right-hand peek on the same route (`?task=`). Object
rows and the peek’s “Open object” link go to `/app/objects/[id]` with `returnTo`
so Back restores the originating list. In-list selection links use
`scroll={false}` so opening a peek does not jump the page.

The peek is a dense inspector on the shared detail rail, not a form card:
14px title, ghost icon pin (tooltip Pin to Home) and Close, then the same status / priority / assignee /
due / project / category triggers used in the list. Project and category pickers on this
surface are borderless. Do not duplicate those values in a second “current”
grid. Do not label the peek “side panel.” If accepted creation evidence exists,
lead with that “why this exists” excerpt. Discussion (activity and comments)
always follows as unboxed rows, including the borderless composer so a
comment can start from the peek. Empty memory and empty related context stay
out of the peek.

The full object page is a Linear-style issue view, not a work-index. It has no
`WorkSubnav`. The type (and task category) sit as quiet metadata above a wrapping 20px title (24px on desktop)
that remains editable and saves on blur or Enter. Board placement is a muted header line, not a standalone
section, and those same boards are not repeated under Connected work. Pin is the shared Home-destination icon; Ask uses the
shared floating binder. Repair memory lives in the overflow menu; project pages
also keep overflow Add task. The main column uses separated sections with readable 14px summary prose.
A generated Summary leads when available; its current-state claims remain in a
closed disclosure with citations intact. Origin and source context is folded
below a generated summary to avoid competing lead paragraphs, and stays visible
when no summary exists. Connected work, evidence, facts, and discussion follow. Connected work omits empty child-task groups on leaf tasks, but keeps a Tasks group on generic objects even
when empty, with `Open N · Done M` totals (not the truncated preview lengths),
always-visible Recent history (quiet
`No completed tasks yet` when Done is 0), assignee
chips (including mobile), inline status, and an add-task field pre-linked to
the current object. Done tasks never show overdue styling; they show a completed
date when one exists, otherwise a neutral due date. Pending approvals stay in the one actionable block at the
top of the page, loaded for that object rather than the workspace-newest 100 bundles
(including pending local-ref dependents after a sibling create is accepted); Evidence is the single evidence list (no second Related))
evidence group). Top-level section titles use 13px
semibold `--fg` (not dim) so Evidence / Connected work / Discussion read as
structure; section counts and timestamps use Commit Mono 11px tabular
`--fg-dim`. Nested Connected work groups use quieter 11px medium `--fg-muted`
and hairline dividers so Tasks / Documents do not compete.
Row titles are 14px medium `--fg`; body and prose stay 14px regular `--fg`;
supporting meta is 12px `--fg-dim` and sentence case (`Create · Identity facet`,
never raw `create · identity_facet`). Empty
“Not enough object memory,” “No connected work,” and “Nothing here yet” cards
are prohibited. Long Evidence, Facts, Documents, and other Connected work lists
preview three rows, then fold the rest behind a quiet `Show N more` disclosure
(with hairline row dividers and two-line evidence clamps) so the main column
does not become a wall of text. Discussion keeps
a borderless composer with @mentions. The right column is one Properties rail at
`22rem` from the lg breakpoint, with a quiet `--surface` background and internal
spacing instead of stacked dividing rules. Editable Properties come first,
followed by board context, editable contact facets (people and
companies), type-aware Details fields (same 32px property rows as Stage/Aliases:
`6.75rem` medium `--fg-dim` labels, 14px `--fg` values, blur-to-save inputs, `No …` placeholders;
arbitrary Add field with human labels stored as camelCase; hover-only ghost × to clear
custom fields; `fixture_version` and other internal keys stay hidden),
Company (person objects), Related, change history, and Archive share that panel.
On mobile, Edit properties beneath the title jumps to the property controls.
Change history starts closed unless suggested changes need review. Technical
details live at the bottom of the rail. Aliases appear in their editable property
without repeating a long alternate-name line beneath the title. Status and Priority keep a toned icon with quiet `--fg`
value text so they match Stage/Aliases. Do not nest a card per
field. The task peek and board card peek retain their compact bordered rail treatment
to lift off the list in light and dark; both include Discussion below command fields and
before related context. An empty summary is a single Generate summary control, not a “ready to generate” block. Evidence uses a
quiet text control, not a signal chip. Supporting copy stays 12px `--fg-dim`.
Quiet fold/actions use 12px medium `--fg-muted`. `--signal` is reserved for
alerts and Accept. Object ID lives in a compact 12px Technical details
disclosure. Relationship and change metadata stay sentence case. Content is
grouped by typography and spacing (`object-detail-type.ts`). Nested bordered boxes
are not a layout system on these surfaces.

Approval rows use the same collection density as Tasks. One row per review
item: selection checkbox, human title once, a short context line (`Create
task · meeting transcript · 17 Aug`), up to three compact metadata values,
and ghost icon actions. Bundle source is a quiet `CollectionGroup` only when
a bundle contains more than one item; do not wrap items in nested cards or a
three-column title/payload/actions grid. Sentence case throughout. Do not
use uppercase mono operation labels, `PROJECT · NONE` pills, or a lime bulk
action stripe.

Show up to three meaningful fields as row metadata (`Due soon · Aug 20`,
`To do`, assignee). The rest of the proposed record lives in the preview.
Calendar match warnings stay on the row as one muted line. Evidence is a
one-line disclosure under the row (`Why · 1 source`) and the same citations
appear inside the preview. Do not render `TechnicalDetails`, cluster IDs, or
output IDs on this queue; those stay on Team → Reconciliation.

Clicking the row (or the quiet preview icon) opens a view-only preview
dialog. Creates show the full proposed record as it would exist. Updates
load a live snapshot of the current object or event and highlight every
changed field against that snapshot. Preview every target kind: objects,
tasks, calendar events, relationships, board memberships, board field
updates, notes, identity facets, and merges. Existing records also show
created and updated timestamps as dim metadata. The dialog is not an
editor. `Change` remains a natural-language rewrite: the reviewer explains
what is wrong, Timeline rewrites the same unresolved proposal, and the row
stays pending. Merge proposals still offer `Review merge` for survivor
choices and also open this preview.

Actionable rows use ghost icon `Accept`, `Change`, `Preview`, and `Reject`.
Accepting or rejecting hides the row immediately, shows a loading toast,
then replaces it with success or error. Failures restore the row. Bulk
accept and reject run from `SelectionBar` after the reviewer selects rows.
The selection bar is the only accept/reject bulk chrome. Approvals keep a
visible Select-all checkbox for the loaded queue, and the same control on
multi-item bundle headers, matching Tasks. Reviewers do not have to tick
every row before Accept or Reject.

Approval counts use individual review items, not proposal bundles. “Pending”
means the item status is literally pending. Failed items remain retryable or
rejectable only under the Failed filter and do not contribute to Home, Work,
digest, or navigation attention. Work attention combines pending approval items
with overdue open tasks. The Work header breaks that aggregate into linked
Overdue and Approvals counts so every attention item has an obvious destination.
Visible overdue tasks are eligible for the queue regardless of teammate assignment.
Queue rows do not repeat the object type: status, assignee, due date, and priority
are inline-editable on object and board items, matching the task list. Approval
rows stay review-only. Due state keeps a consistent right-aligned position and
follows the shared due-date vocabulary above.



### Administrator dashboards

Jobs and Reconciliation list rows show status, a human label, and relative time.
IDs, raw enum keys, and provider errors stay in the row hover title. Copy access
for reconciliation JSON payloads lives in the row overflow menu. Audit and
Integration Audit still keep UUIDs, refs, and JSON closed inside
`TechnicalDetails`. Job recovery pages the 7-day snapshot and finished archive
with the shared infinite-scroll sentinel. Job recovery’s header is title and
subtitle only; older hidden jobs stay in the body banner. Reconciliation has no
stat-card strip and no release-gate banner; coverage actions sit on a toolbar
with hover hints. The dashboard header is title and subtitle only; coverage
counts stay in the screen-reader summary and Advanced tools. Recent clusters
and Recent outputs use the same sentence-case section title as
the rest of the product. Manual UUID reconcile stays in Advanced tools. Job
recovery Advanced tools uses the same quiet disclosure: unprocessed backlog as
count rows, conversation suggestions as a heading with actions, and finished
jobs as status/label/time rows with queue names in the hover title.



Foundations and shared components: [design system](../../design.md).


### Billing benefits and recorded charges

Usage and Billing share the same typed billing summary. Usage presents plan, members,
and recorded charges in a compact summary, followed by responsive meter cards.
Each allowance card shows usage against its allowance and the remaining amount;
positive meter charges stay visible. Detailed recorded charges live in a closed
Billing details disclosure. Included credit and applicable spend caps remain
visible outside that disclosure. Billing settings use the same allowance cards, with separate neutral surfaces for
plan controls, recorded charges, and membership. Plan controls wrap on narrow screens. Free/PAYG show each
calendar-month allowance with used, included and remaining units, plus the UTC
reset date. Team/Business instead show pooled included credit, used and remaining
amounts, and the subscription-period dates. Extra members are separate from that
credit. Every meter remains visible even at zero usage.

“Charges recorded so far” uses settlement records; it is not a forecast or final
invoice. The recurring plan fee is separate. Unknown attribution is Unavailable;
stale credit periods say Updating billing period. No view silently resets credit.
Monthly caps show their own dates and include metered usage before plan credit
plus extra members, excluding fees and tax. PAYG's native allowances are deducted
before its cap is counted. A cap is never presented as free credit.

Sidebar: Free labels the most-used allowance; PAYG labels its monthly cap;
Team/Business lead with credit remaining and a separate cap line. Keep the credit
renewal date distinct from the calendar cap reset. Financial details remain for
owners/admins; members retain the existing limited warning view.

Contractual Enterprise displays agreement-based limits instead of a local cap
warning/editor. Cap warnings follow enforcement applicability; comped Enterprise
keeps its enforced cap. Disabled enforcement is labeled as informational tracking.

Light-mode signal controls use `oklch(0.51 0.15 130)` with near-white foreground; the signal background must retain normal-text contrast. Homepage overrides require separate verification.

Dark-theme dim text uses OKLCH lightness 0.64 (rather than 0.48). Browser sRGB measurement puts it above 5:1 on the secondary dark surface; dim is a hierarchy treatment, not permission for unreadable body text. The pricing browser regression checks both themes’ dim-text surfaces and primary-button pair at 4.5:1 or better.


### Password recovery

Sign-in places “Forgot password?” beside the password label. `/forgot-password`
and `/reset-password` reuse AuthShell and the existing form controls. Request
confirmation does not reveal whether an account exists and keeps the email form
available for retry. Reset asks for matching new passwords (8–200 characters),
announces pending/error/success states, and replaces expired or used links with a
request-new-link action. Success directs the user to sign in again; recovery
remains available without legal acceptance or new-account publication readiness.


### Optional PAYG follow-up

On Home, Free-plan owners/admins who have a persisted assistant answer can see a
quiet PAYG suggestion. Do not show it before an answer, alongside a restriction,
or instead of an existing billing warning. “Not now” dismisses this suggestion
for that user/team in the current browser. The CTA opens plan selection only.


### Coworker account and reporting controls

Connect your agent includes workspace reporting defaults and connection-specific overrides, with explicit on-request/meaningful-handoffs modes and a required ongoing work scope. Account → Agent provisioning shows grant expiry, allowance, capture permission, usage and audit history. Credentials appear once; revocation clearly leaves created workspaces and their independently managed connections intact.

OAuth consent includes reporting directly beneath workspace selection and capture permission. New connections visibly inherit the workspace agreement; owners/admins can set a connection override. Members see their effective agreement. Work scope is required only for an explicit ongoing override; read-only connections clearly identify inactive reporting. No additional wizard or forced first note is introduced.

Website sources are managed from Connections → Sources → Websites. Use compact source rows with one scan action. Adding opens a permission-confirming dialog; history expands beneath its source, and administrator schedule/pause/archive controls live under “Schedule & settings”. Show weekday only for weekly schedules and time/timezone only for recurring scans. Keep the unit rate in a quiet footer and full cost/permission details at confirmation. Archive copy distinguishes stopping capture from erasing evidence.
