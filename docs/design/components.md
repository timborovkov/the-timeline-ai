# Component contracts

Read the [core design rules](../../design.md), then the relevant component below.
Screen specifications live in [app.md](app.md) and [public.md](public.md).

## PageHeader

The default route header. It owns the single sentence-case `<h1>`, an optional
subtitle, leading/trailing actions, and a quiet wrapping 12px metadata row.
Metadata is sans by default; individual values may opt into mono.

The collection variant has compact spacing on desktop, without a bottom rule;
long headings wrap and increase its height. It uses an 18px title,
keeps metadata and actions inline, and exposes the descriptive subtitle to
assistive technology without spending a visible row on it.

## Collection system

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
- `CollectionRow` is at least 44px on desktop. Human titles wrap in full,
  including unbroken strings; never ellipsize or line-clamp the identifying title.
  Titles occupy their own line; context and metadata sit below at every width.
  Row actions keep a stable trailing position by default. Team member and invitation
  rows use the [narrow-container stacking contract](app.md) to preserve identity width.
  Previews overlay the workspace; opening one never changes the row width.
  Virtualized windows keep rendered rows in normal flow with spacers for unseen
  rows, so wrapping content cannot overlap before measurement.
  Task board cards and collection group headings follow the same full-title rule.
  Secondary summaries may truncate when the detail view exposes their full text. Domain content uses
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
- Approval queues use two-line rows with source/time on bundle headers and neutral
  selected surfaces; the bulk Accept action carries the signal color. See the
  [approval presentation contract](../../docs/design/app.md).
- Bulk work uses selection, then `SelectionBar`. Do not mount a persistent
  filled Accept-all / Reject-all bar. Checkboxes may fade in on desktop hover
  or focus and stay visible while selection is active. Collection headers may
  keep a Select-all checkbox visible so bulk selection does not require
  per-row clicks.
- `EditableMetadata` is a quiet, borderless trigger with a minimum 40px hit
  target (28px in compact collection metadata). Pass the displayed value and editor through `EditableMetadata.Value`
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

## Empty states

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

## SectionHeading

A sentence-case semantic `<h2>` at 16px Switzer semibold with optional actions.
Do not recreate route-local uppercase eyebrow headings.

## Button, Input, Textarea, and NativeSelect

Controls are 36px high by default, with 40px allowed for mobile-critical
actions. They use a 4px radius, explicit hover states, and a visible focus
ring. Secondary buttons do not need a persistent filled background. Native
`<select>` controls use the shared `NativeSelect` (same height, radius, hover,
and focus as `Input`). Do not restyle selects with one-off `h-10`,
`rounded-md`, or unhovered gray boxes.

## Relative timestamps

Age metadata (`created`, `updated`, `last synced`, `expires`) uses
`RelativeTimestamp`: Commit Mono 11px, a relative label such as `7 hours ago`,
and the localized date-time on hover (`title` plus tooltip). Calendar chips and
due dates keep their own clock-time and due-date vocabularies. Exact instants
still belong in `TechnicalDetails` when they are implementation detail.

## Card

Cards use a 6px radius, one border, 16px padding, and no shadow. Avoid nesting
cards. `CardTitle` must support the correct semantic heading level or a neutral
element instead of introducing an accidental heading.

## Badge and StatusBadge

Badges use sentence-case sans text. `StatusBadge` converts raw enums into human
labels and maps only failure, destruction, blocking, or overdue work to danger.
Mono is allowed only for citations, counts, or public keys.

## Due dates

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

## Feedback

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

## TechnicalDetails

A native `<details>` with the summary “Technical details,” closed by default.
Its values may use Commit Mono and include explicit Copy controls. Long values
wrap safely. It never opens from a URL unless the entire route is an explicit
audit view.

## Evidence and citations

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

## Adding a shadcn component

Copy the New York variant into `apps/web/src/components/ui/`, then retune it to
this contract: 4px controls, 6px panels, no content shadow, lime only for the
primary action, and imports through `@/components/ui/<name>`.


## Confirmation dialogs

Dialog content uses a constrained grid column and wraps unbroken identifiers.
Long titles and descriptions must not push actions outside the viewport. Dialogs
stay within the dynamic viewport height, with internal scrolling when needed;
footer buttons wrap their text and remain reachable at 200% text size. Titles
reserve space for the close icon. Shared application confirmations and alerts
initially focus the heading so long content starts in view; input dialogs keep
initial focus on the input. Enter used to commit IME composition does not submit
the dialog; submission requires a subsequent non-composing Enter or the action
button. Closing restores focus to the launcher, including
Escape and Cancel.

Clipboard failure messages wrap below their action group without pushing adjacent
controls off-screen. Copy feedback belongs to the current value and latest copy
attempt; value changes clear it, and late responses from older attempts cannot
overwrite the current result.
