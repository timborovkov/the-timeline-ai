# The Timeline — Design System

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
- Dashboard sections, page headers, form groups, and empty states use spacing
  rather than top/bottom framing rules. Do not stack borders on nested wrappers.
  Keep hairlines for dense data rows, sticky chrome, tabs, and control boundaries;
  a filled collection group header needs no additional horizontal rules. Loading
  states follow the same boundary treatment as the loaded view.
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

Both families are self-hosted and preloaded with `next/font/local`. Use
`display: optional` so a slow font response cannot reflow an already-painted
page. A cold visit may retain the metric-adjusted fallback for that page view;
cached fonts are available on subsequent loads.

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
- Account menu destinations have leading 16px Lucide icons; Agent provisioning
  uses `Bot`. Its page pairs a compact grant form with a grants/activity column
  on wide screens, stacking on mobile. Empty collections use `EmptyState`;
  grants use `CollectionRow` with readable expiry dates and explicit status.
- The shell owns consistent page gutters: 16px on mobile and 32px on desktop,
  with a centered `max-w-6xl` content container. Collection indexes (Work and
  its tabs, Timeline, Documents, Meetings) mark their frame with
  `data-app-width="collection"`. Their section bands and row separators extend
  to the main pane edges while labels, controls, and row content retain the
  bounded inner width. Empty and loading states retain the same content width.
  Forms, settings, and reading views keep the default cap without decorative bleed.
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

### Remembered sign-in method

Sign-in and sign-up show a compact neutral “Last used” badge beside the last
successfully used Google or GitHub button, or beside the Email label for
password authentication. Both routes use the same browser preference; a failed
or cancelled attempt does not change it. New browsers show no badge. Keep the
badge readable in both themes. Place OAuth badges on the top-right button edge,
outside the centered icon-and-label flow, with enough spacing between buttons
to prevent overlap. Preserve the existing primary action and provider order. Cookie lifetime
and contents are disclosed in the [cookie notice](apps/web/src/app/cookies/page.tsx).

## Shared components

### PageHeader

The default route header. It owns the single sentence-case `<h1>`, an optional
subtitle, leading/trailing actions, and a quiet wrapping 12px metadata row.
Metadata is sans by default; individual values may opt into mono.

The collection variant is at most 52px tall on desktop, without a bottom rule. It uses an 18px title,
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

- `page` — full collection canvas. No outer border; 64px vertical
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

## Surface patterns

- [Application surfaces](docs/design/app.md)
- [Public website](docs/design/public.md)

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
