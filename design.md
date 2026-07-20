# The Timeline — Design System

**Version:** v3 · Quiet Archive (2026-07-14). Replaces v2 Operational Archive.

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

Success and informational states remain neutral unless action is required.
Color never carries meaning alone. Danger is not used for incomplete, paused,
or merely noteworthy work.

## Typography

Both families are self-hosted with `next/font/local`.

- **Switzer:** display, interface, body, forms, and prose.
- **Commit Mono:** timestamps, citations, counts, shortcuts, code, filenames,
  and public external keys.

| Role | Font and size |
| --- | --- |
| Page title | Switzer 600, 24px |
| Marketing hero | Switzer 600, 36px mobile / 48px desktop |
| Section heading | Switzer 600, 16px |
| Body and controls | Switzer 400–600, 14px |
| Secondary metadata | Switzer 400, 12px |
| Technical value | Commit Mono 400, 12px |

Use 1.35 line height for dense rows, 1.55 for normal interface copy, and 1.65
for long-form prose. Article text is limited to 65–70ch.

## Layout and navigation

The authenticated product keeps eight primary destinations: Home, Timeline,
Ask, Work, Documents, Meetings, Connections, and Team.

- Expanded sidebar: 240px. Collapsed rail: 56px.
- Shell header: 48px.
- Main page container: one shell-owned `max-w-6xl`; routes must not create a
  competing outer page width.
- Full-canvas chat and boards may opt into full bleed.
- Inspector: hidden until content exists. Desktop uses the right pane; mobile
  uses a focus-managed bottom sheet.
- Work routes share `WorkSubnav`: Overview, Objects, Tasks, Boards, Calendar,
  Approvals.
- Team settings use URL-backed `SettingsNav`: Members, General, Preferences,
  Visibility, Email, Exports, and admin-only Advanced.

The `IndexStrip` is restricted to Timeline and explicit audit/operator views.
It supplements the page title and must never create a second heading.

## Shared components

### PageHeader

The default route header. It owns the single sentence-case `<h1>`, an optional
subtitle, leading/trailing actions, and a quiet wrapping 12px metadata row.
Metadata is sans by default; individual values may opt into mono.

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

Citation chips remain the primary evidence symbol: compact, mono, lime, and
keyboard operable. Opening a citation shows a human source summary first.
Exact timestamps, ownership/visibility internals, source IDs, payloads, and raw
provider data sit inside the inspector’s `TechnicalDetails`.

## Surface examples

### Home

Home starts with a plain `PageHeader`, then a concise Ask composer with the only
lime action in the initial viewport. Attention shows only non-zero actionable
groups. “You’re caught up” replaces empty dashboard grids. Digest, pinned work,
recent moments, and one next setup step follow without duplicating Timeline or
Connections.

### Timeline

Timeline is the strongest archive expression. Each row leads with time, source,
human title, one supporting line, and meaningful impact/status. The rail, sticky
dates, evidence quick view, and pagination remain. Exact capture and provider
details move into the inspector. Compact Home moments reuse the same formatter.

### Ask

Ask uses a standard sans header. Human/assistant role labels are quiet 12px
text; citations remain mono and lime. Tool execution is collapsed. Pinned
objects always have a human label. Prompts handed off from Home are stored
briefly in team-scoped session storage and never in the URL.

### Work and settings

Work pages share one subnavigation and lead with the task at hand, not a grid of
links. Team settings render one URL-selected section at a time. Save state stays
local to the edited form. Member, object, source, and artifact labels never
fall back to UUIDs.

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

The public landing page keeps the earlier archive marketing structure: sticky
landing nav, large hero with proof mock, problem before/after, concept diagram,
surfaces, integrations, cited receipts, principles, FAQ, and final CTA. Mono
index strips and uppercase section labels remain appropriate on that marketing
surface. Legal pages use the shared public shell at reading width (65–70ch).
Help uses the same public shell at wide width with a sidebar nav; article bodies
may optionally constrain to a reading measure without forcing the shell narrow.

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
- Motion is minimal-functional: 80ms hover, 120ms overlay transitions, and no
  page transitions. `prefers-reduced-motion` disables non-essential animation.

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
