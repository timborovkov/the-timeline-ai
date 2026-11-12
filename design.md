# The Timeline — Design System

This is the visual and interaction contract for the product. If a screen
disagrees with it, fix the screen. Intentional changes update the relevant
contract in the same change.

Read these core rules, then the reference sections relevant to your change:

- [Component contracts](docs/design/components.md): shared controls, collections, feedback, citations, and toasts.
- [App screens](docs/design/app.md): workspace screens, installed-app behavior, and administrative controls.
- [Public pages](docs/design/public.md): marketing and public-site patterns.
- [Decision history](docs/design/decisions.md): archived rationale, including superseded choices; not required reading for routine UI work.

Keep universal rules here and specialized requirements in their owning reference.
Do not repeat requirements or append implementation histories to current contracts.

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

The authenticated product keeps nine primary destinations: Home, Timeline,
Ask, Work, Documents, Meetings, Connections, Usage, and Team.

- Desktop and mobile primary navigation keep that destination order in three
  labeled groups: Overview (Home, Timeline, Ask), Workspace (Work, Documents,
  Meetings, Connections), and Manage (Usage, Team). Collapsed rails retain the same
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
- Full-canvas chat and boards may opt into full bleed. The shell supplies their
  available height, including banners; routes do not subtract a fixed header
  height from the viewport or cancel shell gutters with negative margins.
  Tasks keep the same canvas in loading, populated, and filtered-empty states. Timeline opts into
  flush-top so its sticky `CollectionToolbar` can sit under the 48px header;
  date bands follow its measured height when controls wrap;
  do not hide main padding with a negative sticky `top`.
- Provider-created chat sessions use a compact `TG`, `SL`, or neutral `EXT`
  badge in desktop and mobile history. Web-created sessions remain unbadged;
  provider identity must not replace the human-readable session title. Each
  row shows last-activity age; archive stays hidden until hover or focus on
  desktop. A search field under New chat filters history. The Ask heading keeps
  the selected title on the same row and does not show a session count.
- Task, object, and board previews, inspectors, and Connections drawers share the modal `Sheet` reading surface:
  fixed to the viewport, up to 48rem (768px), full-width on smaller screens.
  Opening or closing an overlay must preserve the underlying page width and
  scroll position. Use history updates for panel URLs, not native hash scrolling.
  Keep a wrapping header and close control above an independently scrolling body;
  secondary descriptions wrap and row metadata stacks inside panels. Focus is
  contained, Escape dismisses, and closing restores focus without scrolling.
- Work routes share `WorkSubnav`: Overview, Pinned, Objects, Tasks, Boards,
  Calendar, Digests, Approvals. Collection tabs sit flush against the following
  toolbar or group; Calendar uses 24px below tabs before its standalone controls,
  and creation and merge forms retain breathing room. Loading states mirror the
  same header alignment, tab spacing, toolbars, and row geometry.
- Objects cleanup is a quiet toolbar action beside New object. It opens a review
  dialog with a pending count and an explicit empty state, rather than adding
  a separate strip above the list. Objects and Tasks use the full collection
  canvas with compact chrome.
- Object and task previews use the same detail rail, at least 36rem (576px), growing to 55% of the content width
  on wide screens and a focus-managed bottom sheet below 1280px. Keep the title,
  pin, close, and full-width, quiet outlined “Open object” action together at the top.
- Billing settings share Usage’s allowance cards and neutral surfaces, with clear
  spacing between plan controls, charges, and membership. See the
  [billing presentation contract](docs/design/app.md#billing-benefits-and-recorded-charges).

- Team settings use URL-backed `SettingsNav`: Members, General, Preferences,
  Visibility, Email, Exports, and admin-only Advanced.

The `IndexStrip` is restricted to explicit audit/operator views. Timeline uses
a sticky collection toolbar under the 48px shell header instead of an index
strip or loaded-count heading.

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
  transform/opacity and reduced-motion contract in
  [public pages](docs/design/public.md).

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
