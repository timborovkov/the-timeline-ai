# The Timeline — Design System

**Version:** v3.41 · Object-page tasks (2026-11-09).
Replaces v3.40 Drive Limited Use disclosure and public product screenshots.

This is the visual and interaction contract for the product. If a screen
disagrees with it, fix the screen. If the language intentionally changes,
update this document in the same change.

## Direction

**Human meaning first; evidence and technical detail one click away.** The
Timeline is a calm working archive: concise enough to scan, rigorous enough to
trust, and explicit about its evidence when a person asks for it.

The evidence-driven identity remains structural through the timeline
chronology, citations, inspectors, and audit disclosures. It is not expressed
by exposing database implementation details in ordinary product views.

### Product language

- **Event history** is the immutable sequence of captured source events.
- **Evidence** is source material backing a generated claim or proposed change.
- **Updates** are cited answers or progress summaries generated on demand.
- **Digests** are recurring summaries of change and attention.
- **Handoffs** are evidence-backed context packs for a teammate or stakeholder.
- **Operational memory** is durable, queryable work state derived from history.
- **Signal classes** (internal) split events into communication, captured
  work, and pulses so the product can relate evidence without treating every
  source event as a model prompt. Intentional captures stay communication.
  Curated documents are reference knowledge, not a fourth class. Timeline
  **event class** is the presentation family (communication, work record,
  pulse, incident, artifact, schedule), not signal class: a Drive
  file-changed ping can be a pulse for ingest and an artifact for the
  inspector. Do not put either label in ordinary chrome.
- **Work hubs** (internal) are the tasks, projects, people, and artifact
  clusters that events from different surfaces attach to. Ordinary chrome
  still names the task or project, not "hub." Proposal chrome should show the
  attached client or project when one was qualified; it should not invent a
  "hub" label. Channel and board names that uniquely name a client are qualify
  evidence, not chrome.
- **Memory grade** (internal) is the hub's role: goal, work, finding, or
  mention. Ordinary chrome still names the task or company. Do not add a
  second importance slider; `priority` 1–4 stays urgency on goals and work.
- **Artifact clusters** connect evidence that describes the same real-world
  work while keeping evidence association separate from source authority.
- **Approval-backed state** is durable work state that passed human review.
  How events become that state is
  [`docs/relational-memory.md`](docs/relational-memory.md).

Count chrome: Moments mode and digest headlines count **moments**; All events,
source filters, and technical disclosures count **source events**. Moment rows
do not show competing signal chips; the inspector uses **evidence items** for
conversations and an **Activity** log for pulses. Do not show competing moment
and raw-event totals in the same chrome.

Prefer concrete customer language over internal architecture terms. A user
should understand what happened, what needs attention, and what they can do
next before seeing how the system represented it.

## Core rules

- Every route has exactly one `<h1>`.
- Switzer is the default face for navigation, headings, body, labels, statuses,
  buttons, and form controls.
- Commit Mono is reserved for timestamps, citation markers, shortcuts, counts, code,
  filenames, and recognizable public external identifiers such as `TL-101` and
  `PR #42`.
- Internal database identifiers are implementation details. UUIDs, hashes, raw
  event IDs, output IDs, payload references, source references, cursors, and
  JSON appear only in a closed `TechnicalDetails` disclosure or an explicit
  audit export. Team → General is the exception for support: the workspace id
  and slug are readonly copyable fields, not ordinary chrome.
- Sentence case is the default. Uppercase is limited to short audit/index codes
  and literal citation syntax.
- One lime primary action per view. A secondary action is outline, ghost, or
  link treatment.
- Content panels use a 6px radius; controls use a 4px radius.
- Pills are for person avatars, filters, and compact state toggles only.
- Content surfaces use a hairline border or one background step. They do not
  use shadows. Shadows are reserved for menus, dialogs, sheets, and overlays.
- Dashed borders are prohibited.
- Dense rows are welcome, but metadata is subordinate to the human title.
- Async mutations announce progress and outcome with a viewport-sticky toast.
  Route banners are for durable page-level failures, not the result of a click
  that already left the viewport.
- Collection indexes, queues, and directories use `CollectionRow` density.
  Nested card grids and three-column review layouts are not collection chrome.
- No gradients, emoji as interface symbols, or extra chromatic accents in the
  authenticated product. The public landing concept diagram may use a single
  signal-colored sweep gradient for the capture → memory motion.

## Color

The neutral OKLCH palette and single lime signal remain. Tokens live in
[`globals.css`](apps/web/src/app/globals.css).

| Token | Purpose |
| --- | --- |
| `--bg` | Page background |
| `--surface` | Panels, cards, inspector |
| `--surface-2` | Hover, inputs, selected neutral surfaces |
| `--border` | Hairline separators |
| `--border-strong` | Focus and emphasized boundaries |
| `--fg` | Primary text |
| `--fg-muted` | Supporting text |
| `--fg-dim` | Non-essential metadata; light-mode lightness 0.50 to preserve small-text contrast on all three surfaces |
| `--signal` / `--signal-soft` | Primary action, active route, citation |
| `--danger` | Failure, destructive state, overdue work |
| `--status-progress` | Active, doing, and in-progress work |
| `--status-review` | Proposed, pending, and review states |
| `--status-success` | Done, shipped, and complete states |

Collection status color is muted and always paired with a glyph and readable
label. Outside collection status metadata, success and informational states
remain neutral unless action is required. Danger is not used for incomplete,
paused, or merely noteworthy work.

## Typography

Both families are self-hosted with `next/font/local`.

- **Switzer:** display, interface, body, forms, and prose.
- **Commit Mono:** timestamps, citations, counts, shortcuts, code, filenames,
  and public external keys.

| Role | Font and size |
| --- | --- |
| Page title | Switzer 600, 24px default / 18px object, task detail, and collection variant |
| Auth and help marketing hero | Switzer 600, 32px mobile / 48px tablet / 60px desktop |
| Public acquisition display | Switzer 600, 64px mobile / fluid up to 150px desktop |
| Section heading | Switzer 600, 16px |
| Body and controls | Switzer 400–600, 14px |
| Secondary metadata | Switzer 400, 12px |
| Technical value | Commit Mono 400, 12px |

Use 1.35 line height for dense rows, 1.55 for normal interface copy, and 1.65
for long-form prose. Article text is limited to 65–70ch.

## Layout and navigation

The authenticated product keeps eight primary destinations: Home, Timeline,
Ask, Work, Documents, Meetings, Connections, Usage, and Team.

- Desktop and mobile primary navigation keep that destination order in three
  labeled groups: Overview (Home, Timeline, Ask), Workspace (Work, Documents,
  Meetings), and Manage (Connections, Usage, Team). Collapsed rails retain the same
  order and expose every destination through its icon label and tooltip.
- Expanded sidebar: 240px. Collapsed rail: 56px. The product mark uses the
  same 12px inset as primary destinations and links to Home (`/app`). Fold and
  unfold is a quiet chevron, not a boxed panel glyph.
- Shell header: 48px.
- Main page container: one shell-owned `max-w-6xl`; routes must not create a
  competing outer page width.
- Full-canvas chat and boards may opt into full bleed. Timeline opts into
  flush-top so its sticky `CollectionToolbar` can sit under the 48px header;
  do not hide main padding with a negative sticky `top`.
- Provider-created chat sessions use a compact `TG`, `SL`, or neutral `EXT`
  badge in desktop and mobile history. Web-created sessions remain unbadged;
  provider identity must not replace the human-readable session title. Each
  row shows last-activity age; archive stays hidden until hover or focus on
  desktop. A search field under New chat filters history. The Ask heading keeps
  the selected title on the same row and does not show a session count.
- Inspector: hidden until content exists. Desktop uses a reading pane up to
  `min(40%, 36rem)`; mobile uses a taller focus-managed bottom sheet.
- Work routes share `WorkSubnav`: Overview, Pinned, Objects, Tasks, Boards,
  Calendar, Digests, Approvals.
- Team settings use URL-backed `SettingsNav`: Members, General, Preferences,
  Visibility, Email, Exports, and admin-only Advanced.

The `IndexStrip` is restricted to explicit audit/operator views. Timeline uses
a sticky collection toolbar under the 48px shell header instead of an index
strip or loaded-count heading.

### Installed app launch

Home-screen Timeline uses the existing mark on `#0a0e0d`. Android Chrome
composes the splash from the web app manifest `name`, `background_color`,
`theme_color`, and 512px icon. iOS ignores that manifest splash and needs a
startup image per device size and orientation. Those images are the same dark
field with the centered mark — no wordmark, no extra chrome, no light-mode
variant. Keep them in lockstep with
[`apps/web/src/app/icon.svg`](apps/web/src/app/icon.svg); regenerate with
`bun apps/web/scripts/generate-pwa-splash.ts`.

## Shared components

### PageHeader

The default route header. It owns the single sentence-case `<h1>`, an optional
subtitle, leading/trailing actions, and a quiet wrapping 12px metadata row.
Metadata is sans by default; individual values may opt into mono.

The collection variant is at most 52px tall on desktop. It uses an 18px title,
keeps metadata and actions inline, and exposes the descriptive subtitle to
assistive technology without spending a visible row on it.

### Collection system

Workspace indexes and queues use the slot-based collection primitives in
`apps/web/src/components/collections/`. Domains keep ownership of their row
content and actions; do not replace them with a configuration-heavy universal
table.

- `CollectionToolbar` is one 44px control row for search, result count, a
  Filters trigger, view controls, and primary actions. Filters open in a
  popover on desktop and a bottom dialog on mobile. Active filters appear in a
  removable chip row only while active. Pass chrome through named children
  (`CollectionToolbar.Search`, `.Count`, `.Filters`, `.View`, `.Actions`,
  `.ClearAll`) rather than JSX props. The compound slot components stay
  server-safe so they keep a `data-collection-slot` marker across the RSC
  client boundary. Inventory counts belong next to search (`24 of 847`
  filtered, `847` unfiltered). Filter-only toolbars such as Work → Pinned and
  Approvals have no inventory chip; labeled totals stay in page metadata or
  group headers.
- `CollectionGroup` uses a 40px header with glyph, readable status label,
  count, and optional action. Groups start open; collapse state lasts only for
  the mounted session and is never saved as a preference.
- `CollectionRow` is at least 44px on desktop. It favors one line: selection or
  type cue, human title, compact context, metadata, and overflow. Mobile uses
  two lines: title plus context, then wrapping metadata. Domain content uses
  named children (`CollectionRow.Leading`, `.Title`, `.Subtitle`, `.Context`,
  `.Metadata`, `.Actions`) rather than JSX props. Optional `.Subtitle` sits
  under the title for board-local next steps and similar secondary lines. Pass
  a native `title` on `.Title` and `.Context` when hover should show IDs,
  timestamps, or raw errors. Every row
  keeps a Linear hairline bottom border, including the last row. Do not wrap
  collection lists in left/right borders or partial boxes. Non-board collections
  must never force
  horizontal viewport scrolling. Row actions use the shared `ItemActionGroup`,
  `ItemIconButton`, and `ItemOverflowMenu` primitives so item-owned controls
  stay labeled, wrap without scrolling, and remain visible without hover.
  Hover background is the row affordance. When a row opens a preview or detail,
  clicking the row (except interactive children) does that; keyboard users get
  the same action from the row, and a quiet icon button may repeat it. Do not
  add a large text “Preview” button.
- Row decision and utility actions are ghost icon buttons (32px), with an
  accessible name and `title`. They are not filled or outline buttons. Accept,
  Change, and Reject stay inline as one coordinated set. Destructive hover may
  use danger color; the resting state stays quiet.
- Bulk work uses selection, then `SelectionBar`. Do not mount a persistent
  filled Accept-all / Reject-all bar. Checkboxes may fade in on desktop hover
  or focus and stay visible while selection is active. Collection headers may
  keep a Select-all checkbox visible so bulk selection does not require
  per-row clicks.
- `EditableMetadata` is a quiet, borderless trigger with a minimum 40px hit
  target. Pass the displayed value and editor through `EditableMetadata.Value`
  and `EditableMetadata.Editor` children. Select-like changes save immediately
  and optimistically. Text and date changes commit with Apply or Enter and
  cancel with Escape. Failed saves roll back, return focus, and report through
  the shared action toast. Do not add a second inline row error.
- `SelectionBar` appears only after selection. Desktop checkboxes may fade in
  on row hover or focus and remain visible while selection is active. Touch
  layouts expose selection explicitly and keep its checkboxes visible.

Status order and vocabulary remain domain-owned. Semantic tones are shared:
backlog/open/todo/archived/cancelled are neutral; active/doing/in progress are
amber; proposed/pending/review are blue; done/shipped/complete are green; and
blocked/failed/overdue use danger. P1 uses danger, P2 amber, and P3/P4 neutral.
Lime remains reserved for the primary action, active route, and citation
signal.

Collection transitions last 150–200ms and are limited to background, border,
opacity, and transform. They honor reduced motion. No collection introduces a
new global keyboard shortcut; existing inspectors, drag handles, infinite
scroll with virtualization, evidence links, and URL state remain the interaction
contract. Collection inventories use `24 of 847` when a filter is on and `847`
when it is not, and only when search or labeled page metadata gives that number
a unit. Timeline, Work → Pinned, and Approvals have no toolbar inventory chip.

### Empty states

Collection indexes, queues, directories, and side lists use one shared
`EmptyState` (`apps/web/src/components/empty-state.tsx`). Do not invent a
second empty layout. The composition is always:

1. One quiet Lucide icon at 28px (20px in compact), `text-fg-dim`, 1.5 stroke.
2. A sentence-case title in 14px Switzer semibold.
3. One explanation in 14px `text-fg-muted`, max 28rem, 1.5 line-height.
4. Optional actions. Zero, one, or two controls. Never a dummy
   “Back to home” just to fill the slot.

Sizes:

- `page` — full collection canvas. Hairline top/bottom borders, 64px vertical
  padding. Timeline, objects, tasks, boards, approvals, inbox, documents.
- `inset` — inside a `CollectionGroup`, board lane, or settings subsection.
  No extra outer border. 40px vertical padding.
- `compact` — popovers, chat session rails, and other dense chrome. 32px
  padding and the smaller icon.

Actions:

- If the person can create the missing thing, show that control. Lime
  `Button` only when this empty state is the view’s sole primary create
  (for example Boards hides the header create when the list is empty).
  If the header already has the create control, the empty-state control is
  outline and may point at the next-best recovery (capture, connect, clear
  filters).
- Filter-empty states recover with “Clear filters” / “Clear search”.
- Waiting states (approvals, notifications, captured files, reconciliation)
  explain what will arrive. They may offer an outline path such as
  “Open timeline”. They must not invent a create action the person cannot
  perform.

Copy:

- Titles stay factual: `No boards yet`, `No proposals to review`,
  `No tasks match this filter`, `No pins yet`. No exclamation marks and
  no “Nothing here yet” / “Nothing pinned yet” openings. Waiting queues
  use the same `No …` shape (`No jobs need attention`).
- Body is one or two short sentences: what this surface is, what happens
  next, and what the person can do.
- Distinguish an empty corpus from a filter miss. Filters never pretend
  the archive is gone.
- Object and task detail still omit empty memory, related-context, and
  notes cards. Digest empty groups stay omitted. Infinite-scroll
  terminators are a short centered hairline, not a “No more matching …”
  sentence. The bound label stays in the accessibility tree.
  Auth “No account yet?”, the Ask composer prompt, Home attention
  “You're caught up”, and combobox/command-palette “no matches” copy
  are not collection empty states.

### SectionHeading

A sentence-case semantic `<h2>` at 16px Switzer semibold with optional actions.
Do not recreate route-local uppercase eyebrow headings.

### Button, Input, Textarea, and NativeSelect

Controls are 36px high by default, with 40px allowed for mobile-critical
actions. They use a 4px radius, explicit hover states, and a visible focus
ring. Secondary buttons do not need a persistent filled background. Native
`<select>` controls use the shared `NativeSelect` (same height, radius, hover,
and focus as `Input`). Do not restyle selects with one-off `h-10`,
`rounded-md`, or unhovered gray boxes.

### Relative timestamps

Age metadata (`created`, `updated`, `last synced`, `expires`) uses
`RelativeTimestamp`: Commit Mono 11px, a relative label such as `7 hours ago`,
and the localized date-time on hover (`title` plus tooltip). Calendar chips and
due dates keep their own clock-time and due-date vocabularies. Exact instants
still belong in `TechnicalDetails` when they are implementation detail.

### Card

Cards use a 6px radius, one border, 16px padding, and no shadow. Avoid nesting
cards. `CardTitle` must support the correct semantic heading level or a neutral
element instead of introducing an accidental heading.

### Badge and StatusBadge

Badges use sentence-case sans text. `StatusBadge` converts raw enums into human
labels and maps only failure, destruction, blocking, or overdue work to danger.
Mono is allowed only for citations, counts, or public keys.

### Due dates

Due dates are workspace calendar dates even though persistence and machine
contracts remain ISO timestamps. A due date becomes overdue only after its
workspace-local day ends. Canonical midnight-UTC values preserve their encoded
`YYYY-MM-DD`; non-midnight legacy or provider timestamps resolve to a calendar
date in the workspace timezone. “Due soon” includes the next 14 calendar days.

Every user-facing due date uses one of these readable states and always keeps
the exact localized date visible:

- `Overdue · Jul 19, 2026` — danger
- `Due today · Jul 20, 2026` — signal
- `Due soon · Jul 28, 2026` — signal
- `Due · Aug 20, 2026` — neutral
- `No due date` — dimmed

Compact cards may omit the separator but not the state or exact date. Date
numerals use tabular styling. Color is supporting information only. Native date
inputs show the same readable state as a hint below the control.

Show `No due date` for tasks, follow-ups, projects, deals, and every board item.
Do not add it to people, companies, vendors, calendar events, or generic
approval queue rows. Search, previews, approval cards, daily digests, and
overdue notifications use the same vocabulary. REST, MCP, export, retrieval,
embedding, and evidence payloads retain their raw ISO values.

### Feedback

Authenticated mutations use one quiet toast stack (`sonner` via `Toaster` in
the root layout). Toasts are viewport-sticky, bottom-right on desktop and
bottom-center on small screens, and limited to three visible at a time. They
use the popover surface, hairline border, and the existing success / danger /
muted tokens. Do not enable rich color toasts. Honor reduced motion.

Use the shared `notifyAction` lifecycle in [Action toasts](#action-toasts) for
async work:

1. Apply the change locally immediately. After 150ms, if the request is still
   in flight, show one processing toast with a spinner and a short gerund
   (“Accepting proposal…”, “Saving event…”, “Uploading file…”).
2. Replace that same toast with success or error copy when the promise
   settles. Do not leave a loading toast up after the work finishes.
3. On success, prefer a concrete object title (“Accepted Review planning
   workbook”) over a generic “Saved”.
4. Offer Undo on the success toast only when a reverse mutation already
   exists (pin, category, complete). Do not invent undo for irreversible
   canonical writes such as accepting an approval.
5. Optimistic lists may hide the row immediately (Linear-style). If the
   mutation fails, restore the row and show the error toast. Do not also
   mount a page-top banner for the same failure.
6. Forms with an explicit Save control may keep inline field errors. They
   still toast the terminal success or failure so a scrolled-away user sees
   the outcome.
7. Durable route failures (load error, missing permission, empty required
   evidence) stay on the page. Toasts do not replace `ErrorState` or
   `InlineError`.

Loading skeletons must mirror the live chrome: collection headers use the
collection `PageHeaderSkeleton`, indexes use `CollectionRowsSkeleton`, and
Timeline uses the current rail layout. Never show card-grid skeletons for a
row collection.

### TechnicalDetails

A native `<details>` with the summary “Technical details,” closed by default.
Its values may use Commit Mono and include explicit Copy controls. Long values
wrap safely. It never opens from a URL unless the entire route is an explicit
audit view.

### Evidence and citations

Timeline rows themselves are the inspector affordance. Conversations and
meetings read as stories; pull requests, issues, and other named records read
as compact work records; CI, telemetry, and webhook chatter read as one-line
pulses. Opening a row shows a human source summary first. Original source
(full message, email HTML, transcript, or webhook/JSON payload) sits in a
collapsed inspector disclosure with a readable preview: HTML in a sandboxed
frame, text as prose, JSON in Commit Mono. Attached documents link to the
document drive. Exact timestamps, ownership/visibility internals, source IDs,
and other implementation keys stay inside `TechnicalDetails`. Ask answers and
object summaries cite sources as small lime superscript numbers in first-appearance
order, reusing the number when the same source is cited again. Raw `[ev:…]`
tokens stay out of the answer and off client/project summaries. Hovering on desktop, tapping on mobile, or
keyboard focus opens a compact preview card: source icon, author, date, a
one-line quote, and the existing named destination. Provider logos sit on a
white tile in both themes. Escape closes the card. Those tokens do not appear
on timeline rows. Each inspector evidence item shows the matching copyable
`[ev:…]` chip so a cited source can be identified without putting database IDs
on the archive list. Inspector chips still open the evidence-first preview:
the readable excerpt, a collapsed original-source disclosure (HTML, text, or
JSON payload), and named destinations instead of a generic “Open full page.”
A meeting citation’s primary action is the transcript page, with calendar and
Timeline moment links when those records exist. Document citations open the
library (and the capturing timeline event when known); calendar citations open
the event on Calendar and can jump to the mirrored Timeline moment. Other
kinds keep one primary workspace page — object, task, board, or help route.

Pack-backed approvals show a compact “Why · N sources” disclosure on the
collection row and the same citations inside the view-only preview. Bundle
evidence remains contextual. Raw IDs, pack fingerprints, ranks, relationship
strengths, and visibility internals stay out of the default view. If visible
required evidence changed after proposal creation, show a plain-language stale
warning, disable Accept and Change, and keep Reject available. If required
evidence is no longer visible or active, do not render the derived proposal at
all.

## Surface examples

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
duplicating Timeline or Connections. These sections prefer horizontal rules and
rows over bordered dashboard cards.

The latest digest stays folded until opened. Its summary and section bodies are
readable prose, not inventories of pull requests or IDs. The generator bans
pull-request numbers, commit hashes, CI run IDs, ticket keys, and object
UUIDs: it scrubs them from the briefing packet, retries a draft that still
lists them, and discards that draft if the rewrite fails. Narrative sections
use Highlights, Status, Completed, In progress, Decisions, Risks, and
Follow-ups; Status is the current state of work, not a product-specific label.
Empty sections and empty task, object, or calendar groups are omitted. The
header shows the digest date; the covering time range stays footer metadata.
Activity is a hairline count strip using the same mono lime numbers as Home
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
single title line, and at most one muted context line. Do not duplicate the
icon on a rail node, and do not stack source, actor, title, and preview as
separate competing headings. Stories and records share that same skeleton;
pulses stay one muted line. Impact on the row is omitted; the inspector shows
workspace consequences, structured facts, a matching `[ev:…]` citation chip per
source evidence item, and a collapsed Original source
disclosure. Attached files link to Documents. Sticky dates (`top-11` under the
toolbar) and infinite scroll with virtualized rows remain. The default view ends at the current instant so
materialized calendar occurrences do not displace recent work. Upcoming context
is an explicit seven-day view; the Calendar surface owns the complete future
schedule. Compact Home moments are a denser scan of the same formatter: time,
source, and title only, linking into this surface. Timeline pin and overflow
actions stay visible without hover, using the shared item-action primitives.

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
copyable support fields — team id and slug — with hairline section structure
and no nested cards.

Team → Members is a collection: compact header, `CollectionRow` members with
visible role and quiet actions, not a padded card list. Role changes save on
select. Remove, resend, and revoke are tooltiped icon buttons. Invite, pending,
removed, and export lists use the same rows. Other settings sections stay
forms, with hairline section structure, 12px muted labels, compact `sm`
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

Meetings keep the collection header and rows. Capture and saved-meeting setup
forms sit in a closed disclosure so the list is the default view. The Saved tab
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
`WorkSubnav`. The type (and task category) sit as quiet metadata above an 18px
editable title. Board placement is a muted header line, not a standalone
section, and those same boards are not repeated under Connected work. Pin is the shared Home-destination icon; Ask uses the
shared floating binder. Repair memory lives in the overflow menu; project pages
also keep overflow Add task. The main column uses a dense section stack and 14px body at 1.35
line-height: why this exists, a generated summary only when it has content or
an actionable generate/retry state, then provenance / connected-work /
evidence / facts. Connected work keeps a Tasks group on generic objects even
when empty, with `Open N · Done M`, always-visible Recent history, assignee
chips (including mobile), inline status, and an add-task field pre-linked to
the current object. Pending approvals stay in the one actionable block at the
top of the page; Evidence is the single evidence list (no second Related
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
`20rem` on xl breakpoints: a 6px-radius `--surface` panel with a hairline
`--border`, not raw page canvas. Board context, editable contact facets (people and
companies), type-aware Details fields (same 32px property rows as Stage/Aliases:
`6.75rem` medium `--fg-dim` labels, 14px `--fg` values, blur-to-save inputs, `No …` placeholders;
arbitrary Add field with human labels stored as camelCase; hover-only ghost × to clear
custom fields; `fixture_version` and other internal keys stay hidden), Properties,
Company (person objects), Related, recent changes, and Archive share that one panel
and divide with hairlines. Status and Priority keep a toned icon with quiet `--fg`
value text so they match Stage/Aliases. Do not nest a card per
field. The task peek and board card peek use the same rail pattern so they lift
off the list in light and dark; both include Discussion below command fields and
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

### Marketing and public pages

The public landing page is an editorial, six-scene acquisition narrative:
claim, evidence and chronology, cited answer, Slack-to-cited-answer with an MCP
example, audience fit with trust, and a Start free CTA. The claim scene also
includes a compact For agents card: title and body that agents read the work
record and write notes back like teammates, official Claude, ChatGPT, Cursor,
Grok, OpenClaw, and Hermes marks on white tiles in a single row, and the copyable
`Set up The Timeline - https://thetimeline.cc/llms.txt` command. The card follows
landing `--home-*` tokens in both themes and does not use letter discs. The claim defines The Timeline as an auto-updating work record:
what is said in Slack, Telegram, email and calls becomes current client, deal,
task and decision records, with the source for every line and human approval
before anything changes. Audience copy describes how teams work (chat-run teams
on Slack or Telegram, with the rest of the work spread across email, calls and
documents), not team size or role. Updates are daily, with no weekly framing.
The chronology scene names the cost of rebuilding status, promises and decisions
from conversation before showing how selected work becomes an inspectable record.
Its signature example project, Acme rollout, shows five cited work sources
converging into one work record, with a linked Telegram group as the first source.
Captured work settles onto a chronological rail, connects to project, person,
task, and calendar context, and resolves into an answer with tangible source
links. The cited-answer evidence cards keep “Inspect example source” as a native
`<details>` disclosure aligned to the padded titles: a custom chevron beside the
summary, padded expanded text, and the landing lime `:focus-visible` ring around
the summary rather than an unstyled full-width browser outline. Suggested
durable workspace changes remain approval-backed; the diagram never implies that
evidence silently rewrites canonical objects. Acme rollout is
the canonical fictional public demo corpus across landing, connector, and guide
examples; every rendered example states that it is illustrative and not
customer data. Provider pages may show distinct slices, but people, identifiers,
records, and outcomes stay coherent across the journey. Connector capability belongs with the
evidence-entry scene; audience fit and the evidence chain remain a separate,
stacked explanation rather than an equal-height split. Substantive copy and
diagrams are server-rendered; a small client motion controller may progressively
reveal scenes, replay each evidence diagram while it is in view, and show scroll
progress. Background motion is prohibited: movement belongs to the evidence
diagram and must explain provenance or hierarchy. The shared public canvas uses
the same subtle fixed grain in both themes, with theme-specific blending so
cream reads like paper and near-black retains its tactile texture.

The landing hero keeps the observatory composition: six compact source cards sit
around a square grid and stream packets along visible curved paths into the
official Timeline mark. The centered diamond is labelled **The Timeline** and
**Work record**; one quiet rail then resolves into **Daily update** and
**Cited answers**. It does not reproduce the expanded timeline, record cards, or
assistant exchange. Every moving packet reuses the exact path drawn behind it,
the animation restarts only when the diagram enters view, and reduced motion
hides the packets while preserving the complete static explanation. Mobile
retains the same topology and removes secondary metadata so cards and labels do
not overlap.

The landing page moves directly from the compact observatory into its chronology,
connector, cited-answer, and trust scenes. The complete four-stage product loop
lives on `/how-it-works`, where it has enough room to explain the platform without
turning the home page into a second hero. The reusable expanded diagram groups
inputs into conversations, meetings and documents, and delivery and incidents;
keeps five representative source-linked events; shows four useful record types;
and closes with one compact assistant exchange across Web, Slack, Telegram, and
an own MCP agent. Permitted live CRM context, approval-backed Timeline changes,
and enabled MCP tool effects remain explicit.

Motion in the expanded diagram explains causality rather than introducing whole
columns. Signal packets repeatedly traverse the exact responsive track between
stages and through the local timeline and answer exchange, while nearby nodes
briefly acknowledge their arrival. Each stage activates independently as it
enters view. Wide layouts use one four-stage row, medium containers use a 2 × 2
grid without decorative connectors, and narrow containers stack stages with
vertical packet tracks. Reduced-motion mode hides packets and preserves the
complete static story.

The public header stays uncluttered: Product, Use cases, Integrations, Agents,
and Pricing. Use cases and Integrations are `details` dropdowns on desktop and
in the mobile menu. Expandable rows show a down chevron when collapsed and an up
chevron when expanded; the mobile Menu overlay must not invert those icons.
Second-level nav popups use a hairline border, compact padding, and a short
black-based shadow in light and dark mode rather than a large foreground glow.
The Integrations dropdown is the hub, then Slack · Native sync and Telegram ·
Capture, then Google Drive, GitHub, Linear, Monday.com, Sentry, then Connect
MCP tools. Slack and Telegram keep those status labels so channel-history sync
is not confused with deliberate capture. Other live destinations stay as plain
product names. The menu does not list Jira or Notion as if they were native
integrations. Coming-soon tools stay on the integrations hub cards and their
pages, not in the header dropdown or footer Integrations column. How it works,
Help, Trust, and head-to-head Compare pages remain in the footer. The footer is
columnar: Product, Use cases, Integrations, Compare, and Legal. `/compare` is a
thin hub for head-to-head pages versus Day AI, Folk, Glean, Geekbot, Suda,
MemoryCrow, and Achiral. Those pages keep the honest “vs” framing and also
target “[competitor] alternatives” on the existing URLs rather than extra
doorway routes; every competitor fact cites and links that competitor's own
site. Notion stays under Integrations, never as a vs page.
Works-with pages live under `/integrations` (Linear, Jira, Notion, HubSpot,
Attio, Pipedrive), not under Compare: Linear has native ingest, Jira and Notion
explain hosted MCP lookup and link to `/integrations/mcp`, and HubSpot, Attio,
and Pipedrive native ingest is coming soon. `/integrations/mcp` is the general
guide for connecting third-party MCP servers to The Timeline Agent, distinct
from `/agents`. Retired `/compare/{hubspot,jira,linear,notion}` URLs
permanent-redirect to the matching integrations page.

Use-case pages extend this story for six jobs from one record: work record,
team daily log, communication trail, CRM, task board, and onboarding and repeat
questions. They live under `/use-cases`, appear in the public Use cases menu,
and are registered for sitemap and LLM discovery. `/compare` remains an
indexable vs-only hub reachable from the footer. `/agents` leads with agents as
teammates who report work into the record and read cited context back over MCP,
plus the same copyable setup card as the landing page. Retired solution URLs
`/solutions/weekly-project-updates` and `/solutions/crm-context-from-team-activity`
permanent-redirect to the matching use-case pages. Client project handoffs remain
at `/solutions/client-project-handoffs` with related use-case links. `/product-tour`
is a screenshot walkthrough linked from the home hero as See it first and from
pricing; `/integrations/telegram` is the public Telegram capture page. Product
screenshots live in `apps/web/public/marketing/screenshots` under the filenames
from the website copy plan. Landscape slots use a 16×10 top crop; mobile
portrait slots keep the full capture so Ask citations stay in frame. The
homepage shows three full-width proof shots (work record, stored cited Ask
answer, daily update). `/agents` pairs the current Agent tools screen with a
write-in / read-out diagram for external agents. `/integrations/mcp` has a
separate inbound live-lookup diagram for The Timeline Agent calling third-party
MCP tools. `/use-cases` opens with a conversations → work record → six jobs
diagram rather than a screenshot wall. Referenced screenshot files are
inventory-tested so a missing asset fails CI instead of shipping as a silent
placeholder. Public screenshot slots serve the committed PNG bytes (unoptimized)
so a recapture cannot stay hidden behind a stale image-optimizer cache. Ask
captures are stored fictional examples; captions say that plainly without
install or implementation noise.
Visible copy must stay consistent with deliberate capture, source-linked claims,
daily (not weekly) updates, and human review before inferred durable workspace
changes. Do not claim WhatsApp, Teams chat, or Slack Connect.

Public pages may use oversized Switzer display type, denser Commit Mono source
metadata, a near-black evidence-instrument canvas, and more cinematic spacing
than the authenticated Quiet Archive. Motion must explain provenance or
hierarchy, use transforms and opacity, and opt in only under
`prefers-reduced-motion: no-preference`; the default HTML is a complete static
narrative. Public pages still use one lime signal, hairline structure, and no
decorative AI gradients. Connector references distinguish native ingestion
(GitHub, Linear, Google Drive, Monday.com, Slack, and Sentry), hosted live MCP
access, local-desktop MCP access, and planned support. Local-desktop entries
must never imply they connect from hosted Timeline; planned destinations stay
unlinked and unindexed until real. The landing claim owns the largest display
scale. Integration directory and connector-detail titles use a subordinate,
capped display scale so long provider headlines preserve the first viewport's
explanation and evidence.
Review dates, implementation labels, indexing state, and capability-tier names
belong in metadata and the typed content manifest, not visible marketing chrome.
Public copy explains the same truth through customer actions and constraints:
what enters the record, what is looked up only on request, what requires local
setup, and what cannot be connected yet.
The integration directory leads with implemented first-party capture surfaces:
Telegram and Slack conversation capture, forward/CC/BCC email,
participant-notification-gated-by-default Google Meet/Microsoft Teams/Zoom
transcripts, and named textual ingest webhooks.
It then presents the six native provider-record connectors separately. Slack
appears in both groups because conversational capture and selected-channel
history sync are distinct contracts; public copy must say so. Generic ingest
webhooks are evidence-only, meeting capture stores transcripts rather than raw
audio, and implemented surfaces may still require workspace or provider setup.
The directory uses the expanded public acquisition measure with a narrow fixed
section-index rail so two-up capture and provider cards retain a readable text
measure instead of being squeezed by a proportional sidebar.

Every public shell uses the landing masthead as one full-width chrome component,
with the same warm public palette, wordmark position, active state, GitHub and
theme controls, and lime account CTA. Signed-in visitors see `Dashboard`;
signed-out visitors see `Sign in` and `Start free` (free / no-card). The shared public canvas
inherits that warm paper palette in light mode and the landing's warm near-black
palette in dark mode, while each page group keeps its own content structure.
Auth-neutral loading and error boundaries keep the same masthead but omit
account actions rather than guessing the visitor's session state.
The landing main landmark remains focusable for skip navigation but suppresses
the browser's page-sized focus outline; interactive controls retain their focus indicators.
The masthead exposes five primary destinations in this order:
Product (`/`), Use cases (`/use-cases`), Integrations (`/integrations`), Agents (`/agents`),
and Pricing (`/pricing`). Desktop headers show them directly, compact widths use a native
menu disclosure, and the columnar footer repeats them plus How it works, Help, Compare, and Legal. The
current destination uses `aria-current="page"`. At phone widths, sign-in and
theme controls move into the disclosure instead of disappearing, and the
disclosure closes after link activation or a persisted-layout route change.
Native connector labels on the landing page link to their integration detail
pages, while native source badges in public walkthroughs link back to the same
provider truth. The landing hero and public navigation also link directly to
the project's source on GitHub; the
public help shell and developer docs repeat that path. Legal pages use the
shared public shell at reading width (65–70ch).
Public pricing copy explains plans, usage costs, and billing terms in customer language. Keep sandbox rollout status, implementation terminology, and internal launch assumptions in setup documentation rather than the pricing page.

Help uses the same public shell at wide width with a sidebar nav. Its overview
is one searchable, single-column guide directory rather than repeating the
same destinations in category lists and card grids. Guide and support pages
provide a visible route back to all guides; article bodies may optionally
constrain to a reading measure without forcing the shell narrow.
Agent setup guides may use a bespoke copy-ready pattern: one recommended install
prompt first, narrower skill-only and MCP-only fallbacks, then numbered setup,
usage guidance, and an explicit access FAQ. Copy controls stay adjacent to
their complete prompt or command, secrets never appear in those payloads, and
the guide remains searchable from the Help directory.

`/how-it-works` is the plain-language explanation of how Timeline works. It uses
the same 82rem acquisition grid, 13–15rem indexed section rail, hero scale,
footer, and section rhythm as the integration directory. A short hero leads
directly into the full-width animated platform flow; separate introductory step
cards and trust cards do not repeat that story. The diagram states the capture,
approval, citation, and enabled-MCP boundaries in context, then the next section
zooms into one source-to-answer provenance path. Practical walkthroughs remain
indexable for specific questions, but public navigation and page copy do not ask
visitors to learn an editorial publication, edition, playbook, or dossier
taxonomy.
The legacy `/record` URL permanently redirects to `/how-it-works`; it is not a
second indexable destination.

`/trust` is the public technical security and privacy reference. It follows the
expanded editorial grid, leads with the training-data boundary, then shows the data path,
AI routing, storage and access, processor roles, permissions, current assurance
status, and private vulnerability-reporting route. It must distinguish controls
enforced in code from production-account, contract, and certification evidence;
unverified badges and absolute “nothing leaves our servers” claims are
prohibited. Privacy and Terms remain the detailed legal surfaces and cross-link
Trust. A labelled Legal documents group on Trust links to Privacy, Terms, and
Cookies. Public copy describes customer-relevant controls, policies, and limitations;
operator checklists and evidence-collection tasks stay in the internal operating
standard. Once legal publication is ready, `/legal/accept` is an authenticated
blocking interstitial: one explicit acceptance covers the current Terms and
Privacy versions for that person, and protected product access does not continue
until it succeeds. While production publication is withheld, existing signed-in
users retain product access and `/legal/accept` returns them to the product.

`/cookies` uses the same legal-page reading surface for the exact cookie and
browser-storage inventory. It separates necessary storage, always-on personless
surface-request counts, optional public browser analytics, pseudonymous product
analytics, and reliability monitoring. The first-layer banner names the purpose only, offers equal Accept analytics
and Reject actions, and links Cookie settings. It does not name the vendor.
Cookie settings and the cookies notice name PostHog as the processor, with
purpose and documented retention. The working consent UI never initializes
PostHog before acceptance and never loads browser analytics inside private
workspace routes. Withdrawal stops capture and clears the public PostHog and
attribution state while keeping only the necessary consent-choice record. Every
public footer links the notice and exposes the persistent Cookie settings
control. Public copy calls the fixed-stream totals surface requests, not
visitors or sessions, and notes that bots and retries can contribute.

`/help/support` is both a channel router and the private support form. It sends
account-specific or sensitive requests to the private form/email, reproducible
non-sensitive defects to the structured public issue form, vulnerabilities to
the private security policy, and proposed contributions to the issue-first
contribution guide. Signed-in support context is disclosed and limited to
server-resolved account/team identifiers and role, a normalized app surface,
release, optional error reference, and bounded browser diagnostics. Never put
that context or workspace content in a GitHub issue. Dashboard desktop and
mobile footers use the same “Help & support” label; shared error states pair
Retry with a contextual Get support action.

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

## Action toasts

Actions, edits, and other mutations use one toast lifecycle. Page and query
loads keep skeletons. Field validation stays on the field. Route and query
failures keep `InlineError` with a specific retry.

1. Apply the change locally immediately.
2. After 150ms, if the request is still in flight, show one processing toast
   with a spinner (`Updating status…`).
3. The same toast morphs to success or error. Do not spawn a second toast.
4. On error, roll back the optimistic state and restore focus to the control.
5. Success lasts 2s. Error lasts 6s and is dismissible.

Native form actions must dismiss their loading toast when the form unmounts
for a redirect, revalidation, or error boundary. Completed success/error toasts
keep their normal lifetime across form remounts.

Rapid edits on the same entity share one toast id and replace in place. Two
entities may show two toasts. The stack caps at three.

Copy is sentence case and names the thing: `Updating status…`, `Status updated`,
`Couldn’t update status`. Do not toast raw server strings, UUIDs, or
`Update failed`. A mapped, sentence-like action error may replace the generic
fallback. Undo is a compensating second request after the original write
lands. The first request is not cancelled. Show Undo when the client can invert
the mutation (previous field value, pin toggle, archive/unarchive, or a server
undo token). Hard deletes and canonical approval decisions have no Undo.

Toasts use the popover surface, a hairline border, 6px radius, and an overlay
shadow. Color lives on the icon only. Undo is a same-surface control with a
hairline border, not an inverted fill. In light mode the button stays light;
in dark mode it stays dark. Position is bottom-right on desktop and
bottom-center on small screens, above a `SelectionBar`. Reduced motion replaces
the spinner with a static glyph. Feature code calls `notifyAction`,
`notifyError`, `notifySuccess`, or `notifyProgress` rather than `toast` from
`sonner`. Long-running admin batches may update one loading toast in place
through `notifyProgress`. Completed redirect results (OAuth callback, export
download, queued reconciliation) use that same toast channel instead of a page
banner.

Copyable values use the shared `CopyButton`. The control shows a copy icon plus
label, then a check and `Copied`. Dense technical rows use the icon appearance
with the same swap. Copy success stays on the control. Copy failure stays on
the control with recovery copy. Do not invent a second clipboard helper.

## States and responsive behavior

- Loading skeletons mirror the live page structure and announce busy state.
  Collection routes use the collection header skeleton and `CollectionRowsSkeleton`.
  Timeline uses the current time-rail row. Connections and Team members use
  collection rows, not card placeholders.
- Errors retain route context, explain the failure, and offer a specific retry.
  Mutation failures also toast; they do not rely on a scrolled-away page banner.
- Empty states use shared `EmptyState`: sentence case, one explanation, a quiet
  dim icon, and an action only when the person can create or recover.
- All screens work at 320px, tablet, desktop, dark mode, and 200% zoom without
  document-level horizontal scrolling.
- Authenticated-product motion is minimal-functional: 80ms hover, 120ms overlay
  transitions, and no page transitions. Public acquisition motion follows the
  transform/opacity and reduced-motion contract above.

## Accessibility

- Semantic HTML and heading order come first.
- All controls are keyboard reachable and have visible `:focus-visible` state.
- Dialogs and sheets trap focus, close with Escape, and restore trigger focus.
- Active navigation uses `aria-current`; selected settings/work sections remain
  understandable without color.
- Citation syntax gets a human screen-reader label.
- Critical state never uses `--fg-dim` and never relies on color alone.
- The first interactive element is a visible-on-focus skip link.

## Testing checklist

For every changed surface:

1. Assert one `<h1>`.
2. Verify UUID-only fixtures do not leak into rendered product labels.
3. Tab through controls and close overlays with Escape.
4. Check 320px, tablet, desktop, 200% zoom, light, and dark.
5. Check reduced motion and stable font loading.
6. Test loading, failure, empty, and populated states.
7. Keep a **small** deterministic visual set for high-value seeded routes
   (Linux Chromium only). Do not expand the matrix for every surface/theme;
   prefer layout/behavior assertions for the rest.

## Adding a shadcn component

Copy the New York variant into `apps/web/src/components/ui/`, then retune it to
this contract: 4px controls, 6px panels, no content shadow, lime only for the
primary action, and imports through `@/components/ui/<name>`.

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
| 2026-11-02 | Connections as a flagship settings page | Splits Connections into Sources, Agent tools, and Developer tabs. Email stays a normal capture row; Documents and Meetings stay on their sidebar pages. Agent MCP, Timeline MCP, and webhooks open compact sheets. Figma and other local-only catalog entries sit in Coming soon. |
| 2026-11-03 | Work-record marketing site | Leads public pages with the auto-updating work record, daily updates, and Start free. Adds a Use cases menu, six use-case pages, `/product-tour`, and `/integrations/telegram`. |
| 2026-11-03 | Public Compare and Agents | Header stays Product, Use cases, Compare, Agents, Pricing, with mobile dropdowns. Adds `/compare` works-with pages, `/agents`, a copyable llms.txt command, a pricing FAQ, and a Slack-to-cited-answer landing scene. |
| 2026-11-03 | Compare vs and works-with | Moves works-with pages under `/integrations/{hubspot,pipedrive,attio,linear,jira,notion}`. `/compare` becomes a hub plus `/compare/the-timeline-vs-{day-ai,folk,glean,geekbot}` pages that cite each competitor's site. |
| 2026-11-03 | Numbered answer citations | Replaces Ask `[ev:…]` chips with superscript numbers, a hover/tap source card, reused numbers for the same source, and keyboard/Escape access. Inspector copy chips stay as they are. |
| 2026-11-03 | Object and board citation/lane polish | Object summaries use the same numbered source markers as Ask. Pipeline kanban lanes scroll instead of clipping at 1440. |
| 2026-11-04 | Hosted MCP public copy | Agents, llms.txt, the home MCP example, and the pricing FAQ teach five tools, the default-on capture scope, remember counting toward accepted sources, and Free 100 MB / 10,000 documents / 20,000 chunks. |
| 2026-11-03 | Connect your agent | `/app/connect-agent` is the OAuth-first MCP setup screen. Agent tabs, connected grants, add-memory email/webhook, SKILL.md, and collapsed static keys live there. `/app/team/mcp-share` redirects. Provider logos stay on white tiles; allowed senders stay a list editor. |
| 2026-11-04 | Connect your agent client picker | `/app/connect-agent` leads with a CollectionRow client list and one install path. Official vendor marks sit on white tiles. Connected agents, add-memory, SKILL.md, and static keys share one disclosure stack with no nested cards or stacked `border-y` sections. Admin grant rows show the consenting member next to the client. |
| 2026-11-04 | Agent setup card marks | Replaces letter discs with official agent logos on white tiles, one short lede, and a single logo row on the landing and `/agents` cards. |
| 2026-11-04 | Public monthly calculator | `/pricing` Usage compares PAYG, Team, and Business from paired sliders and exact fields. One hairline results panel, 12px metadata, and the shared billing preview. |
| 2026-11-04 | Google sign-in | Sign-in and sign-up use the official Google G on a borderless white tile inside the existing outline control, at or above the 12px type floor, with Google above GitHub. Drive connection stays on Connections. |
| 2026-11-05 | GitHub sign-in mark | Continue with GitHub uses the official Invertocat on the same borderless white tile as Google so the mark stays visible in dark mode. |
| 2026-11-06 | Public nav IA | Header is Product, Use cases, Integrations, Agents, Pricing. Integrations dropdown is the hub plus Slack · Native sync, Telegram · Capture, then Google Drive, GitHub, Linear, Monday.com, Sentry, and Connect MCP tools. Jira and Notion stay on works-with pages and the hub, not in the native dropdown. Coming-soon CRM pages stay on the hub, not in the dropdown or footer column. Footer is Product / Use cases / Integrations / Compare / Legal. `/compare` is a thin vs-only hub. |
| 2026-11-06 | Integrations chat nav | Integrations dropdown and footer prepend Slack (`Native sync`) and Telegram (`Capture`) so capture is not implied as account-history sync. Other live destinations keep plain product names. |
| 2026-11-06 | Connect MCP tools | `/integrations/mcp` explains inbound third-party MCP servers for The Timeline Agent, distinct from `/agents`. Catalogue copy keeps native vs agent-tool semantics. |
| 2026-11-06 | Public mobile nav chevrons | Expandable Use cases and Integrations rows point down when collapsed and up when expanded. The mobile Menu overlay does not invert those chevrons. |
| 2026-11-06 | Agents as teammates | Landing and `/agents` treat agents as teammates who read the cited work record and write notes back. The setup card keeps the llms.txt command. `/agents` splits report-in (remember / email / webhook) from read-out (hosted MCP tools) and labels the Grok Bot progress-note as an illustrative example. |
| 2026-11-06 | Compare alternatives SEO | Existing `/compare/the-timeline-vs-{day-ai,folk,glean,geekbot}` pages keep the vs H1 and add “[competitor] alternatives” to SEO title, meta description, and intro. The hub names those alternative queries without extra URLs. |
| 2026-11-06 | Company-brain compare pages | Adds `/compare/the-timeline-vs-{suda,memorycrow,achiral}` with the same vs H1 and “[competitor] alternatives” SEO. Footer Compare column lists them; header stays Integrations-only for Notion. |
| 2026-11-06 | Product-tour mobile frames | `/product-tour` mobile portrait shots (`*-mobile.png`) use a 390×844 contain frame instead of the landscape 16×10 top crop, so Ask recap citations stay visible. |
| 2026-11-06 | OAuth auto-verify, team support ids, Drive picker | Google/GitHub sign-in stamps `emailVerified` when the provider asserts a verified email. Team → General shows readonly copyable team id and slug. Drive sharing drops the dense green callout, overlapping helper copy, and nested picker borders. |
| 2026-11-07 | Drive Limited Use disclosure | Connecting or reconnecting Google Drive opens a contextual dialog before Google OAuth. The copy names read-only Drive access, selected-source capture, encrypted tokens, snapshots versus retained events, team sharing, billed change-judging, document extract, and no general-model training. Continue to Google is the affirmative action; Cancel or dismiss does not start OAuth. |
| 2026-11-07 | Agents vs inbound MCP diagrams | `/agents` write-in / read-out stays external-agent contribution and MCP read-out. `/integrations/mcp` shows a separate live-lookup diagram. Screenshot captions label stored fictional examples without install noise. Public slots serve committed PNG bytes unoptimized so recaptures are not hidden by a stale image-optimizer cache. |
| 2026-11-07 | Landing evidence inspect disclosures | Homepage “Inspect example source” rows share the evidence-card padding, a custom chevron, padded expanded copy, and the lime focus ring. |
| 2026-11-09 | Object-page tasks | Connected work Tasks stays visible with Open/Done counts, Recent history, assignee chips, inline status, and a pre-linked add-task field. Approvals and Evidence each appear once. |


### Billing benefits and recorded charges (2026-10-31)

Usage and Billing share the same typed billing summary. Free/PAYG show each
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

## Platform administration

The platform panel uses the existing collection headers, quiet tables, and bordered settings forms. Users, Teams, Audit, and Billing form a compact admin navigation. Sensitive actions live in explicit disclosures with a reason and confirmation. Impersonation has a persistent banner naming the effective user and team, expiry, read-only status when applicable, and an always-visible exit action. Internal identifiers stay in technical-detail disclosures.


### Optional PAYG follow-up

On Home, Free-plan owners/admins who have a persisted assistant answer can see a
quiet PAYG suggestion. Do not show it before an answer, alongside a restriction,
or instead of an existing billing warning. “Not now” dismisses this suggestion
for that user/team in the current browser. The CTA opens plan selection only.

### Public pricing calculator

The pricing Usage section compares PAYG, Team and Business through paired native
sliders and exact number fields. A labelled editable example renders on the server.
Desktop inputs sit beside a single hairline results panel; mobile stacks them.
Plan totals share one border with the selected breakdown underneath — no nested
cards or extra plan-card chrome. PAYG shows native allowances per meter; Team
and Business show a pooled usage-credit deduction. Capacity warnings exclude
unsuitable plans from the lowest-estimated-cost badge. Accepted sources live in
Advanced usage with their value visible when closed. Metadata stays at the 12px
floor. Rates and workspace eligibility remain in the closed How this estimate
works disclosure. Inputs stay local; the calculator neither changes billing nor
collects telemetry.

### Coworker account and reporting controls

Connect your agent includes workspace reporting defaults and connection-specific overrides, with explicit on-request/meaningful-handoffs modes and a required ongoing work scope. Account → Agent provisioning shows grant expiry, allowance, capture permission, usage and audit history. Credentials appear once; revocation clearly leaves created workspaces and their independently managed connections intact.

OAuth consent includes reporting directly beneath workspace selection and capture permission. New connections visibly inherit the workspace agreement; owners/admins can set a connection override. Members see their effective agreement. Work scope is required only for an explicit ongoing override; read-only connections clearly identify inactive reporting. No additional wizard or forced first note is introduced.
