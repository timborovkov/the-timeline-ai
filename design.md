# The Timeline — Design System

**Version:** v3.1 · Quiet Archive collection density (2026-08-16). Replaces v2 Operational Archive.

This is the visual and interaction contract for the product. If a screen
disagrees with it, fix the screen. If the language intentionally changes,
update this document in the same change.

## Direction

**Human meaning first; evidence and technical detail one click away.** The
Timeline is a calm working archive: concise enough to scan, rigorous enough to
trust, and explicit about its evidence when a person asks for it.

The evidence-driven identity remains structural through the timeline rail,
citations, inspectors, and audit disclosures. It is not expressed by exposing
database implementation details in ordinary product views.

### Product language

- **Event history** is the immutable sequence of captured source events.
- **Evidence** is source material backing a generated claim or proposed change.
- **Updates** are cited answers or progress summaries generated on demand.
- **Digests** are recurring summaries of change and attention.
- **Handoffs** are evidence-backed context packs for a teammate or stakeholder.
- **Operational memory** is durable, queryable work state derived from history.
- **Artifact clusters** connect evidence that describes the same real-world
  work while keeping evidence association separate from source authority.
- **Approval-backed state** is durable work state that passed human review.

Count chrome: Moments mode and digest headlines count **moments**; Audit trail,
source filters, and technical disclosures count **source events**. Moment rows
use **signals** for bundled evidence size; the inspector uses **evidence
items**. Do not show competing moment and raw-event totals in the same chrome.

Prefer concrete customer language over internal architecture terms. A user
should understand what happened, what needs attention, and what they can do
next before seeing how the system represented it.

## Core rules

- Every route has exactly one `<h1>`.
- Switzer is the default face for navigation, headings, body, labels, statuses,
  buttons, and form controls.
- Commit Mono is reserved for timestamps, citations, shortcuts, counts, code,
  filenames, and recognizable public external identifiers such as `TL-101` and
  `PR #42`.
- Internal database identifiers are implementation details. UUIDs, hashes, raw
  event IDs, output IDs, payload references, source references, cursors, and
  JSON appear only in a closed `TechnicalDetails` disclosure or an explicit
  audit export.
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
| `--fg-dim` | Non-essential metadata |
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
| Page title | Switzer 600, 24px default / 18px collection variant |
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
Ask, Work, Documents, Meetings, Connections, and Team.

- Desktop and mobile primary navigation keep that destination order in three
  labeled groups: Overview (Home, Timeline, Ask), Workspace (Work, Documents,
  Meetings), and Manage (Connections, Team). Collapsed rails retain the same
  order and expose every destination through its icon label and tooltip.
- Expanded sidebar: 240px. Collapsed rail: 56px.
- Shell header: 48px.
- Main page container: one shell-owned `max-w-6xl`; routes must not create a
  competing outer page width.
- Full-canvas chat and boards may opt into full bleed.
- Provider-created chat sessions use a compact `TG`, `SL`, or neutral `EXT`
  badge in desktop and mobile history. Web-created sessions remain unbadged;
  provider identity must not replace the human-readable session title. Each
  row shows last-activity age; archive stays hidden until hover or focus on
  desktop. A search field under New chat filters history. The Ask heading keeps
  the selected title on the same row and does not show a session count.
- Inspector: hidden until content exists. Desktop uses the right pane; mobile
  uses a focus-managed bottom sheet.
- Work routes share `WorkSubnav`: Overview, Pinned, Objects, Tasks, Boards,
  Calendar, Approvals.
- Team settings use URL-backed `SettingsNav`: Members, General, Preferences,
  Visibility, Email, Exports, and admin-only Advanced.

The `IndexStrip` is restricted to Timeline and explicit audit/operator views.
It supplements the page title and must never create a second heading.

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
  removable chip row only while active.
- `CollectionGroup` uses a 40px header with glyph, readable status label,
  count, and optional action. Groups start open; collapse state lasts only for
  the mounted session and is never saved as a preference.
- `CollectionRow` is at least 44px on desktop. It favors one line: selection or
  type cue, human title, compact context, metadata, and overflow. Mobile uses
  two lines: title plus context, then wrapping metadata. Non-board collections
  must never force horizontal viewport scrolling. Row actions use the shared
  `ItemActionGroup` and `ItemOverflowMenu` primitives so item-owned controls
  stay labeled, wrap without scrolling, and remain visible without hover.
- `EditableMetadata` is a quiet, borderless trigger with a minimum 40px hit
  target. Select-like changes save immediately and optimistically. Text and
  date changes commit with Apply or Enter and cancel with Escape. Failed saves
  roll back, return focus, show an inline row error, and keep the existing
  toast feedback.
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
new global keyboard shortcut; existing inspectors, drag handles, pagination,
evidence links, and URL state remain the interaction contract.

### SectionHeading

A sentence-case semantic `<h2>` at 16px Switzer semibold with optional actions.
Do not recreate route-local uppercase eyebrow headings.

### Button, Input, and Textarea

Controls are 36px high by default, with 40px allowed for mobile-critical
actions. They use a 4px radius, explicit hover states, and a visible focus
ring. Secondary buttons do not need a persistent filled background.

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

### TechnicalDetails

A native `<details>` with the summary “Technical details,” closed by default.
Its values may use Commit Mono and include explicit Copy controls. Long values
wrap safely. It never opens from a URL unless the entire route is an explicit
audit view.

### Evidence and citations

Timeline evidence cues use a compact, mono, lime “View evidence · N signals”
label that makes the inspector affordance explicit and remains keyboard
operable. Opening the evidence inspector shows a human source summary first.
Exact timestamps, ownership/visibility internals, source IDs, payloads, and raw
provider data sit inside the inspector’s `TechnicalDetails`.

Pack-backed approvals show a compact “Evidence for this change · N sources”
disclosure beneath each proposed item, using source, sender, timestamp, bounded
excerpt, and a source-event link. Bundle evidence remains contextual. Raw IDs,
pack fingerprints, ranks, relationship strengths, and visibility internals stay
out of the default view. If visible required evidence changed after proposal
creation, show a plain-language stale warning, disable Accept and Change, and
keep Reject available. If required evidence is no longer visible or active, do
not render the derived proposal at all.

## Surface examples

### Home

Home does not repeat its navigation label as a visible page title. It starts
with a quiet Capture action and the same compact, icon-only-send Ask composer
used in chat. Attention shows only non-zero actionable groups. “You’re caught
up” replaces empty dashboard grids. Pinned work, digest, recent moments, and one
next setup step follow as full-width sections without duplicating Timeline or
Connections. These sections prefer horizontal rules and rows over bordered
dashboard cards.

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
opens Work → Pinned.

### Timeline

Timeline is the strongest archive expression. Each row leads with time, source,
human title, one supporting line, and meaningful impact/status. The rail, sticky
dates, evidence quick view, and pagination remain. Exact capture and provider
details move into the inspector. The default view ends at the current instant so
materialized calendar occurrences do not displace recent work. Upcoming context
is an explicit seven-day view; the Calendar surface owns the complete future
schedule. Compact Home moments reuse the same formatter.

### Ask

Ask uses a standard sans header. Human/assistant role labels are quiet 12px
text; citations remain mono and lime. Tool execution is collapsed. Pinned
objects always have a human label. Prompts handed off from Home are stored
briefly in team-scoped session storage and never in the URL.

The desktop session list stays dense: last-activity age under each title in
mono 11px, a centered 60% hairline between rows, and archive revealed on row
hover or keyboard focus. Hovering the relative age shows the localized
timestamp. A search field under New chat filters the visible history. New chat
uses the shared primary `Button`. Touch session lists keep archive visible.

The Ask heading stays on one row. When a conversation is selected, its title
sits beside the heading as truncated muted text. Session counts do not appear
in the header.

The web Ask surface is the rich research view: answers may be thorough and use
sections, lists, or tables, while inline citations remain inspectable links to
evidence. External chat delivery uses the same retrieval and grounding but a
compact plain-text presentation, normally one short paragraph or three to five
bullets. Telegram, Slack, and future external chat providers never expose
Timeline citation syntax, raw-event IDs, or generic source footers. Explicit
requests for more detail may expand within the provider-safe reply limit.

### Work and settings

Work pages share one subnavigation and lead with the task at hand, not a grid of
links. Team settings render one URL-selected section at a time. Save state stays
local to the edited form. Member, object, source, and artifact labels never
fall back to UUIDs.

Work → Pinned is the complete pin-management surface. It is a single
side-to-side list with cursor pagination and All, Objects, Boards, Documents,
Meetings, Calendar, and Timeline filters. Reordering is available only under
All so filtered adjacency never changes the mixed global order implicitly.
Drag reorder has equivalent keyboard actions for move up, down, top, and
bottom; keyboard moves announce their result through a polite live region.

Detail pages use a visible Pin/Unpin button with `aria-pressed`. Dense rows,
cards, calendar entries, timeline moments, and global-search results keep the
same action inside their overflow menu, whose accessible label includes the
target title. Controls update optimistically, retain focus, and restore the
prior state with a concise error when a mutation fails.

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
footers, field-level table editors, and visible detail-page Pin/Unpin controls
remain in their established ownership zones. Item actions are always visible
or reachable without hover; hidden or paginated items expose no detached or
orphaned controls.

Task category is a compact secondary label in the task/type line, subordinate
to title, status, assignee, due date, and priority. Pending and failed states
use readable text, never color alone. Project is a distinct named relation:
show it in task context lines and editable detail fields, not as another colored
tag or a fourth dense card metadata cell. Archived tasks replace project and
category controls with a short instruction to unarchive the task first.

Approval rows lead with the proposed change and use human labels and localized
values, such as `Due soon · <localized date>` and `Status To do`, rather than payload
keys or JSON. Free-form names and notes stay literal. Reference-valued changes
resolve current member, object, board, lane, and visibility labels at review
time instead of trusting stored display text. Show up to four meaningful fields
inline and keep additional changes in a collapsed disclosure. Calendar match
warnings include the proposed schedule. Evidence uses plain-language source
labels, while every distinct reconciliation record remains reachable through
one closed `TechnicalDetails` disclosure.

Actionable approval rows end with `Accept`, `Change`, and `Reject`. `Change`
opens a compact feedback dialog instead of exposing payload fields: the
reviewer explains what is wrong, Timeline rewrites the same unresolved
proposal, and the refreshed row remains pending. The dialog states that no
canonical change has been applied and that attached source evidence is
preserved. Merge proposals keep their dedicated `Review merge` flow because
their survivor and field choices require a structured preview.

Approval counts use individual review items, not proposal bundles. “Pending”
means the item status is literally pending. Failed items remain retryable or
rejectable only under the Failed filter and do not contribute to Home, Work,
digest, or navigation attention. Work attention combines pending approval items
with overdue open tasks. The Work header breaks that aggregate into linked
Overdue and Approvals counts so every attention item has an obvious destination.
Visible overdue tasks are eligible for the queue regardless of teammate assignment.
Queue rows give due state a consistent right-aligned position and follow the
shared due-date vocabulary above.

### Marketing and public pages

The public landing page is an editorial, five-scene acquisition narrative:
claim, evidence and chronology, cited answer, audience fit with trust, and a
one-project CTA. The claim defines Timeline as an evidence-backed working
history. The chronology scene names the cost of rebuilding status, handoffs,
customer commitments, and decisions across Telegram, Slack, meetings,
documents, tickets, code, and email before showing how selected work becomes an
inspectable record. Its signature example project, Acme rollout, shows five
cited work sources converging into one project history, with Telegram as the
first explicit note. A sixth connected Sentry source is visibly marked as
unused in that answer. Captured work then settles onto a chronological rail and
resolves into an answer with tangible source links. Acme rollout is the
canonical fictional public demo corpus across landing, connector, and guide
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

The landing observatory identifies every source with its provider mark, includes
Telegram alongside Slack, meeting, code, document, and monitoring signals,
and distinguishes evidence cited in the example answer from a connected source
that the answer did not use. It uses small inward-moving packets to explain
ingestion. Those packets use only
transform and opacity, run only while the diagram is visible, and disappear in
the complete reduced-motion state. The evidence-entry summary below chronology
compresses the directory into two honest paths—work people send to Timeline and
selected history from connected tools. More technical distinctions remain in
the underlying content model, not as customer-facing taxonomy.

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
signed-out visitors see `Sign in` and `Try one project`. The shared public canvas
inherits that warm paper palette in light mode and the landing's warm near-black
palette in dark mode, while each page group keeps its own content structure.
Auth-neutral loading and error boundaries keep the same masthead but omit
account actions rather than guessing the visitor's session state.
The masthead exposes the same four primary destinations in the same order:
Product (`/`), Integrations (`/integrations`), How it works (`/how-it-works`), and
Help (`/help`). Desktop headers show them directly, compact widths use a native
menu disclosure, and footers repeat them for recovery at the end of a page. The
current destination uses `aria-current="page"`. At phone widths, sign-in and
theme controls move into the disclosure instead of disappearing, and the
disclosure closes after link activation or a persisted-layout route change.
Native connector labels on the landing page link to their integration detail
pages, while native source badges in public walkthroughs link back to the same
provider truth. The landing hero and public navigation also link directly to
the project's source on GitHub; the
public help shell and developer docs repeat that path. Legal pages use the
shared public shell at reading width (65–70ch).
Help uses the same public shell at wide width with a sidebar nav. Its overview
is one searchable, single-column guide directory rather than repeating the
same destinations in category lists and card grids. Guide and support pages
provide a visible route back to all guides; article bodies may optionally
constrain to a reading measure without forcing the shell narrow.

`/how-it-works` is the plain-language explanation of how Timeline works. It uses
the same 82rem acquisition grid, 13–15rem indexed section rail, hero scale, footer, and
section rhythm as the integration directory. It shows the
source-to-chronology-to-answer loop once, then links to a small set of
substantive cross-tool walkthroughs. Its first viewport explains the three-step
model at a glance: choose what enters, preserve the chronology, then ask and
inspect. It also states two trust boundaries directly: connected does not mean
cited, and durable workspace changes wait for human approval. The complete
evidence diagram follows in its own indexed section and is never squeezed beside
the hero copy. Walkthroughs remain indexable for specific questions, but public
navigation and page copy do not ask visitors to learn an editorial publication,
edition, playbook, or dossier taxonomy.
The legacy `/record` URL permanently redirects to `/how-it-works`; it is not a
second indexable destination.

### Administrator dashboards

Jobs, Reconciliation, Audit, and Integration Audit preserve filters, retries,
replay actions, and copy access. Human summaries and actionable failures lead.
UUIDs, raw IDs, refs, and JSON remain closed inside `TechnicalDetails`.

## States and responsive behavior

- Loading skeletons mirror the new page structure and announce busy state.
- Errors retain route context, explain the failure, and offer a specific retry.
- Empty states use sentence case, one explanation, and one action.
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
| 2026-08-17 | Dense Ask session history | Reveals archive on hover/focus, shows relative last-activity age with a timestamp title, and uses a short centered hairline instead of a persistent trash column. |
| 2026-08-17 | Ask session search and title | Filters chat history from the session rail and shows the selected title beside Ask instead of a session count. |
