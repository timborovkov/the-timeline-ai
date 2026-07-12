# The Timeline — Design System

**Version:** v2 · Operational Archive (2026-05-25). Replaces the v1
warm-neutral + amber direction.

The single source of truth for the visual design of the product. Every
component and page follows this. If a screen disagrees, fix the screen.

## Memorable thing

**The work becomes the record.** A precision instrument that feels forensic
where it matters and quiet everywhere else. Bloomberg Terminal × git log ×
Linear. Every timestamp, every ID, every citation is first-class type. The
product's differentiator — _every claim the agent makes is cited back to a raw
event_ — is structurally visible, not implied.

This is **not** a Notion / Mem / Reflect re-skin. It is an instrument panel
for "what changed, what was promised, and how do you know?"

## Product language

Use language that makes the evidence-derived operating model concrete:

- **Event history** — the immutable sequence of source events created while
  work happens. Prefer this over generic "activity feed" or "log" when the
  source-of-truth role matters.
- **Evidence** — source material that backs a generated claim: raw events,
  meeting transcript chunks, Slack/Telegram messages, emails, document
  versions, integration events, calendar rows, and cited object/task changes.
- **Updates** — on-demand stakeholder answers or progress summaries generated
  from evidence. Do not narrow the product to weekly status reports.
- **Digests** — proactive recurring summaries, especially daily team digests,
  that show what changed and what needs attention.
- **Handoffs** — context packs for a teammate, stakeholder, or operator joining
  a project, account, or decision late.
- **Operational memory** — the durable, queryable record of projects, clients,
  people, commitments, decisions, documents, and work state derived from event
  history.
- **Artifact clusters** — the real-world work artifacts that collect related
  evidence across surfaces, such as a Telegram report, Sentry issue, GitHub PR,
  shared link, contract signature, deal approval, or event-planning thread,
  while keeping source authority separate from evidence association.
- **Approval-backed state** — durable object, task, calendar, relationship, and
  memory changes that came from evidence and passed a human review path.

Avoid leaning on **team memory** by itself in product copy. It is useful
shorthand inside technical docs, but public and customer-facing surfaces should
say what the memory does: generate cited updates, digests, handoffs, answers,
and operational state from work that already happened.

## Stack

- **Tailwind v4** (`@tailwindcss/postcss`) — no `tailwind.config.js`; tokens
  live in CSS via `@theme inline` in
  [apps/web/src/app/globals.css](apps/web/src/app/globals.css).
- **shadcn/ui** — New York style, copied into
  `apps/web/src/components/ui/`. Components reference shadcn-compatible
  aliases (`bg-background`, `bg-card`, `text-primary`) that map to the
  Operational Archive tokens below — no component rewrite needed during the
  v1→v2 swap.
- **Radix primitives** for headless interactive behavior.
- **lucide-react** for all icons. No other icon libraries.
- **next-themes** wired via [`ThemeProvider`](apps/web/src/components/theme-provider.tsx)
  with `attribute="class"`, `defaultTheme="system"`, manual override
  persisted under `tl-theme`.

## Color — OKLCH, single chromatic accent

Cool monochrome base with one acid signal color. Defined as OKLCH (matches
Linear's 2026 move; perceptually uniform; theme generation from a single
chroma point becomes trivial). Defined in `:root` (light, default) and
`.dark` (manual override or `system` → dark).

### Canonical tokens (prefer these in new code)

| Token             | Light                      | Dark                       | Usage                                              |
| ----------------- | -------------------------- | -------------------------- | -------------------------------------------------- |
| `--bg`            | oklch(0.99 0.002 240)      | oklch(0.13 0.005 240)      | page background                                    |
| `--surface`       | oklch(0.97 0.003 240)      | oklch(0.17 0.005 240)      | cards, panels, inspector                           |
| `--surface-2`     | oklch(0.94 0.004 240)      | oklch(0.21 0.006 240)      | inputs, hover, raised surfaces                     |
| `--border`        | oklch(0.88 0.004 240)      | oklch(0.27 0.006 240)      | hairline separators                                |
| `--border-strong` | oklch(0.78 0.004 240)      | oklch(0.38 0.006 240)      | focus rings, emphasized borders                    |
| `--fg`            | oklch(0.18 0.005 240)      | oklch(0.96 0.005 240)      | primary text                                       |
| `--fg-muted`      | oklch(0.40 0.006 240)      | oklch(0.68 0.006 240)      | body / secondary text                              |
| `--fg-dim`        | oklch(0.58 0.006 240)      | oklch(0.48 0.006 240)      | metadata, timestamps, IDs                          |
| `--signal`        | oklch(0.65 0.22 130)       | oklch(0.90 0.20 130)       | active state, CTA, citation chip, streaming caret  |
| `--signal-fg`     | oklch(0.99 0.002 240)      | oklch(0.13 0.005 240)      | text on signal background                          |
| `--signal-soft`   | oklch(0.65 0.22 130 / .14) | oklch(0.90 0.20 130 / .16) | citation chip background, selection, subtle fills  |
| `--danger`        | oklch(0.55 0.22 25)        | oklch(0.70 0.20 25)        | destructive actions, overdue, error                |

### Shadcn aliases

These existing names point at the canonical tokens above so shadcn
components keep working untouched:

- `--background` → `--bg`
- `--foreground` → `--fg`
- `--card`, `--popover`, `--muted` → `--surface`
- `--secondary`, `--accent` → `--surface-2`
- `--card-foreground`, `--popover-foreground`, `--accent-foreground`,
  `--secondary-foreground` → `--fg`
- `--muted-foreground` → `--fg-muted`
- `--primary` → `--signal`
- `--primary-foreground` → `--signal-fg`
- `--destructive` → `--danger`
- `--input` → `--border`
- `--ring` → `--signal`

### Rules

- **One chromatic accent.** Signal lime is the only non-neutral color in
  the system. Used sparingly: active route in nav, primary CTA, citation
  chips, streaming caret, "new since last visit" markers, kanban "due this
  week" state.
- **No semantic color rainbow.** Success / warning / info collapse to
  muted fg tones. Only `--danger` gets its own hue (and only for
  destructive actions and overdue items).
- **No gradients. No drop shadows beyond hairlines.** Surfaces lift via a
  one-step background tint (`--bg` → `--surface` → `--surface-2`), never
  shadow.

### Radius

`--radius: 2px` default. Scale: `sm` 2px, `md` 4px, `lg` 6px, `xl` 8px. No
`rounded-full` except for circular person avatars and the streaming caret.
Cards, buttons, inputs all max out at `--radius-md` (4px).

## Typography — monospace as a first-class UI face

**Two families, self-hosted via `next/font/local`:**

- **Switzer** ([apps/web/public/fonts/switzer/](apps/web/public/fonts/switzer/)) —
  variable-weight grotesque from Indian Type Foundry. Display + UI + body.
  Loaded as a variable font (100–900). CSS var: `--font-sans`.
- **Commit Mono** ([apps/web/public/fonts/commit-mono/](apps/web/public/fonts/commit-mono/)) —
  humanist slab mono by Eigil Nikolajsen. Weights 400, 400 italic, 700. CSS
  var: `--font-mono`.

Both registered in [layout.tsx](apps/web/src/app/layout.tsx) and exposed
via the `--font-switzer` / `--font-commit-mono` CSS variables.

### The radical move

**Monospace is not hidden in code blocks.** It is the primary face for
every timestamp, every event ID, every citation reference, every entity
ID, every status code, every metadata strip. Roughly 20–30% of pixels on
screen are mono. This is the forensic-archive signal.

`font-feature-settings: 'tnum' 1, 'zero' 1, 'ss01' 1` is applied globally
to all mono usage so columns of numbers align and zeros disambiguate from
O.

### Banned typefaces

Never propose as primary: Inter, Roboto, Arial, Helvetica, Open Sans,
Lato, Montserrat, Poppins, **Geist Sans** (the 2026 convergence font),
Space Grotesk, system-ui as a primary display face.

### Scale

| Size   | px  | Use                                |
| ------ | --- | ---------------------------------- |
| `xs`   | 12  | metadata strips, IDs (mono)        |
| `sm`   | 13  | dense lists, table rows            |
| `base` | 14  | default body                       |
| `lg`   | 16  | subheads, prose                    |
| `xl`   | 20  | section titles                     |
| `2xl`  | 28  | page titles                        |
| `3xl`  | 40  | marketing hero only                |

Line height: 1.35 in dense surfaces (timeline, board, table), 1.55
default, 1.65 in long-form prose.

### Patterns

- **Eyebrow label** above titles uses mono: `text-xs uppercase tracking-[0.14em] text-fg-dim font-mono`.
  Reserved for operational surfaces. Standard pages use `<SectionHeading>`
  (sentence-case) instead.
- **Page title:** `text-2xl font-semibold tracking-tight` (Switzer 600,
  letter-spacing -0.02em). Operational surfaces render the title inside
  `<IndexStrip>` (mono uppercase, `segments[0]`); standard surfaces render
  it via `<PageHeader title>`.
- **Metadata one-liner** (index strip): `text-xs font-mono uppercase tracking-[0.12em] text-fg-muted`.
  On standard pages, `<PageHeader metadata>` renders the same strip below
  the sentence-case title.
- **Long-form note / doc body:** Switzer 400, 16px, line-height 1.65, max
  `60ch` width.

## Layout — three-pane, density-variable

Departs from the v1 centered `max-w-3xl` prose column. New shell:

```
┌─────┬──────────────────────────────────┬─────────────────┐
│sidebar│  command bar  (⌘K, always on)  │  inspector pane │
│labels │ ───────────────────────────────│  (collapsible)  │
│+ team │  index strip                   │                 │
│Home   │  EVENTS · 2,847 · 14d · acme   │  citation src   │
│Ask    │ ───────────────────────────────│  raw evidence   │
│Work   │  feed / board / object / chat  │  related links  │
│Docs   │                                │                 │
│Connect│                                │                 │
│Team   │                                │                 │
└─────┴──────────────────────────────────┴─────────────────┘
```

### Surface split — operational vs standard

Not every page is a terminal. The forensic `IndexStrip` + mono-uppercase
eyebrows belong on **operational** surfaces where the product's
"differentiator is structurally visible" promise lands. **Standard**
surfaces (settings, hubs, connect flows) get a readable Switzer `<h1>`
via `<PageHeader>` and sentence-case `<SectionHeading>`. Data (counts,
IDs, status, team name) stays mono in a metadata strip — the title does
not.

| Surface kind | Pages | Header treatment |
| ------------ | ----- | ----------------- |
| Operational | Timeline, Approvals, Jobs, Audit, Objects list, Boards, Tasks, Work, Inbox | `<IndexStrip>` + mono eyebrows. Dense, terminal-grade. |
| Standard | Home, Connections, Documents, Team, Team integrations, Slack, Telegram, MCP share, Provider accounts, Personal MCP, Calendar, Meetings | `<PageHeader title subtitle>` + `<SectionHeading>`. Mono reserved for data. |

If a screen disagrees with its kind, fix the screen — or reclassify the
surface here in the same PR.

- **Left sidebar** (`w-64` = 256px default, foldable to `w-14` = 56px):
  eight primary destinations: Home, Timeline, Ask, Work, Documents, Meetings,
  Connections, Team. Nav labels and the current team are visible by default. Folded mode
  uses the icon-only rail with tooltips. Active route shows a 2px signal-color
  bar at its left edge plus `bg-surface-2 text-signal`. Work groups Objects,
  Tasks, Boards, Calendar, and Approvals; Meetings owns notetaker
  capture, saved meeting links, and transcripts; Documents owns the document drive,
  captured-file triage, version review, and previews. Documents is a
  knowledge-first surface: curated uploads are the default team library, while
  event-backed files live in a secondary Captured inbox until promoted. Inbox lives as a
  notification bell in the shell header with a compact unread badge and a
  dropdown preview. Connections groups Email, Slack, Telegram, Meetings,
  Ingest webhooks, Integrations, and MCP servers. Work and Connections may show compact numeric
  attention badges; zero
  state stays hidden. Their hub pages use the same hairline grid as the
  sidebar IA and expose status chips for counts, health, and next actions. A
  muted secondary Help link sits above the team switcher and opens `/help` in a
  new tab; it is discoverable without competing with the primary route list.
- **Main column** fills available width. **No `max-w-3xl` artificial
  column** except long-form prose surfaces (single document view, single
  note view) — those wrap in a `<ProseContainer>` that sets `max-w-prose`.
- **Floating chat trigger** appears only at tablet/desktop widths where it
  does not cover operational rows. On mobile, Ask remains available through
  the primary navigation sheet; fixed chrome must not obscure timeline
  evidence, board rows, or inspector content.
- **Right inspector pane** (`w-96` = 384px, collapsible to 0): shows
  citation source, summarized raw event evidence, related objects, and audit
  trail. Long ids truncate visually with full values available on hover. Large
  raw-event groups are capped with an overflow count. Hidden by default;
  opens when the user clicks a citation chip, an object reference, or the
  inspector toggle. Raw event evidence links use a quick-view dialog first, with
  a direct link to the full timeline row inside. This inspect-before-navigation
  pattern is the structural expression of "every claim is cited." Below the
  desktop inspector breakpoint, the same content opens as a dismissible bottom
  sheet with a scrim and focused close control.
- **Global search palette** persistent across the top of the main column.
  Cmd+K focuses. The palette is navigational: it previews grouped results for
  pages, work records, timeline events, documents, and calendar items, while
  Enter without a selected result opens the full search page.

### Density

- `--row-h-compact` = 28px (board rows, dense table rows)
- `--row-h-standard` = 36px (nav items, list rows, table rows)
- `--row-h-comfortable` = 48px (mobile, primary nav, settings forms)

Linear-tight on operational surfaces. Comfortable on mobile and on forms.

## Components

### Primary symbols

- **Citation chip** — `<CitationChip id="c:1923" />`. Monospace,
  signal-color foreground on `--signal-soft` background, 1px signal-tinted
  border, `rounded-sm` (2px), literal brackets in the text. Event evidence
  chips open a quick-view dialog with the raw event preview first; the dialog
  carries the link to the full timeline row. This is the product's primary
  visual symbol — it should be recognizable from a thumbnail.
- **Index strip** — `<IndexStrip />`. A mono uppercase one-liner replacing
  decorative page headers on **operational** surfaces:
  `EVENTS · 2,847 TOTAL · LAST 14d · TEAM acme · FILTER →`. Top + bottom
  hairline border. Inspired by `git log --stat` and Bloomberg terminal
  header bars. `segments[0]` is the page `<h1>`.
- **Page header** — `<PageHeader title subtitle metadata />`. Standard
  page header for **non-operational** surfaces (Home, Connections, Team,
  Connections, Calendar, etc.). Title is a Switzer 600 `text-2xl`
  `<h1>` (sentence-case); optional `subtitle` is `text-sm text-fg-muted`;
  optional `metadata` renders as the same mono uppercase data strip
  `IndexStrip` uses (counts, team name, role, status), `aria-hidden` with
  an `srLabel` sentence-case summary for screen readers. Data stays mono;
  the title does not. One `<h1>` per page.
- **Section heading** — `<SectionHeading actions>`. Sentence-case
  `<h2>` (`text-base font-semibold tracking-tight text-fg`) for section
  titles on standard pages. Optional right-aligned `actions` slot.
  Replaces the mono-uppercase eyebrow labels (`font-mono text-[11px]
  uppercase tracking-[0.14em]`) that sat above content blocks. Operational
  surfaces keep mono eyebrows for their metadata strips; this component
  is for plain section titles on non-operational pages.
- **Document row** — compact, dense, and operational. The headline is the
  display title, not necessarily the stored filename: human names win,
  generated filenames use `metadata.suggested_title`, and unsupported cases
  fall back to generic attachment labels. The row exposes kind, source, size,
  version, processing/indexing state, visibility, updated date, and one-line
  model-generated understanding when available.
- **Document detail command center** — preview/content is the primary pane.
  Metadata, provenance, agent/indexing state, and actions sit beside it on
  desktop or stack below on mobile. Images and PDFs render inline from signed
  URLs. Unsupported files show extracted text or model-generated
  representations plus download.
- **Setup checklist** — `<TimelineOnboardingChecklist />`. A dense,
  dismissible tutorial panel for the Home Dashboard, not the dedicated
  timeline browser. It uses a hairline-bounded header, mono progress counter,
  and a horizontal strip of fixed-width action cards for each capture/source
  step. Completion uses the signal accent; incomplete steps stay neutral with
  one direct CTA.
- **Inspector pane** — `<InspectorPane>` with `<InspectorHead>` (mono
  uppercase + ID), `<InspectorBody>` (key/value `<dl>`, mono), and
  `<InspectorQuote>` (Switzer, signal-color left border) for surfacing
  source quotes.

### Existing primitives (retuned)

- **Cards** — `rounded-sm border bg-card`, no shadow. Hero surfaces
  (capture composer, command bar) get a single hairline border, no
  shadow. The **timeline loses its card chrome entirely** — flat indexed
  rows with hairline separators (see Timeline rules below).
- **Buttons** — `rounded-sm`. Primary: `bg-signal text-signal-fg`,
  square corners. Ghost: no background. Outline: 1px border, no fill.
  Destructive: signal-color is never used; `bg-transparent text-danger border-danger/40`.
  Square keyboard shortcut chip in mono: `<kbd className="font-mono text-[11px] bg-surface-2 border px-1.5">⌘K</kbd>`.
- **Forms** — chrome-less inputs in dense surfaces (just a bottom
  hairline); bordered inputs (`rounded-sm border bg-surface`) only on
  standalone forms (auth, settings). Inline error text under fields in
  `text-danger text-xs`.
- **Chat bubbles** — user right-aligned with `bg-surface-2 rounded-sm`;
  assistant left-aligned with a 2px signal-color left border, no
  background. Citation chips inline in assistant prose. Role label as
  mono eyebrow: `text-[11px] font-mono uppercase tracking-[0.14em] text-fg-dim`.
- **Composer** — sticky at bottom of main column (`sticky bottom-6`),
  `rounded-sm border bg-surface`, send button absolutely positioned
  inside as a 36px signal-color square.
- **Empty states** — no dashed-border boxes. A single mono uppercase line
  with one inline action link in signal color:
  `NO EVENTS YET → CAPTURE FROM telegram, email, OR ⌘K`.
- **Filters** — collapsed by default behind a `<details>` summary; expand
  into an inline `rounded-sm border bg-surface p-4` panel.
- **Avatars** — monogram only, `rounded-sm` (2px) for teams,
  `rounded-full` for people. No `bg-primary/12` color tint — use a 1px
  border + mono initials in `text-fg-muted`. Never load image avatars.
- **Dialogs & confirmations** — shadcn `AlertDialog` for destructive
  confirms (use `variant="destructive"`), shadcn `Dialog` for general
  modals. Never `window.confirm` / `alert` / `prompt`.
- **Toasts** — `sonner` via `<Toaster richColors />` in
  [layout.tsx](apps/web/src/app/layout.tsx). `--border-radius: var(--radius-md)`.
  Theme syncs to `next-themes`.
- **Theme toggle** — [`<ThemeToggle />`](apps/web/src/components/theme-toggle.tsx)
  in the top bar. Dropdown with Light / Dark / System options. Default
  `system`.

### Timeline (special-cased)

The timeline is the canonical operational surface and the redesign's most
visible change.

- **Dedicated surface.** `/app` is the Home Dashboard for capture, concise board
  shortcuts, onboarding, ingest access, quick actions, the latest daily digest,
  pending approvals, and compact recent activity. `/app/timeline` is only the
  full archive browser: timeline browsing, filtering, pagination, inspection,
  and source evidence. Free-form search lives in `/app/search`.
- **Timeline moments, not raw rows by default.** The browser is date-first:
  sticky date sections contain source clusters, and each cluster contains one
  or more raw events behind the user-facing moment.
- **Indexed rail, no cards.** Moments sit on a left date/time rail with source
  markers and hairline separators. Avoid floating cards; use hierarchy, icons,
  spacing, and rail structure to create the visual timeline shape.
- **Scan fields.** Every moment exposes when, source, actor/speaker, place or
  source context, a plain-language title, subtitle, preview, transcription
  state, evidence count, and the first impact signals without opening the
  inspector.
- **Impact strip.** Show workspace consequences in a dedicated strip when
  present: tasks, boards, objects, calendar events, documents, decisions,
  follow-ups, and approvals. Hydrate from existing source evidence, suggestion
  evidence, object/task changes, document versions, and calendar rows. Omit the
  strip when empty rather than inventing completeness.
- **Related evidence stays quiet.** When a moment belongs to a cross-source work
  artifact, the row shows a compact `Related` signal with the viewer-authorized
  artifact label and signal count. Search results and the inspector use `Related
  evidence` wording; the inspector owns the full bundle: related source
  snippets, provider/source labels, evidence roles, strength, timestamps, links
  back to timeline events, and which visible sources are allowed to update
  canonical status.
- **Calendar state.** Recurring calendar rows show a compact recurrence marker,
  modified occurrences use the same marker plus their edited time, and proposed
  slots render as visible tentative holds until one slot is confirmed.
- **Preset filters.** Timeline presets stay conceptual and source-oriented:
  All, Chat, Meetings, Email, Documents, Calendar, and Integrations. Exact
  source filters such as Telegram, Slack, and ingest webhooks, plus impact
  filters such as tasks, decisions, and approvals, live in the full filter
  panel. A separate `Specific source` control refines the archive to an
  integration provider or one observed provider resource/conversation, such as
  a Monday.com board, GitHub repository, Slack channel, or Telegram chat. Keep
  this selection shareable in the URL and populate it from source registries
  visible to the current user plus a bounded window of visible historical
  events.
- **Attribution split.** Scan-level copy preserves source truth ("who said or
  did it in the source system"). Timeline control details such as captured by,
  source owner, visibility owner, event controls, and curated source metadata
  live in the inspector.
- **Compact row + inspector.** The row handles quick comprehension: title,
  subtitle, preview, impact chips, transcription state, and evidence count. The
  right inspector handles raw source evidence, full impact context, exact
  timestamps, citations, visibility controls, audit trail, and source metadata
  without turning high-volume groups into raw log dumps.
- **Audit trail naming.** The raw source-event escape hatch uses the technical
  route state `mode=events`, but user-facing controls label it `Audit trail`.
  Keep `Source events` for implementation docs and audit/debug language, not as
  the primary tab label.
- **Agent parity.** Chat and automation tools should retrieve timeline moments
  for narrative questions and expand to raw source events for citations. The UI
  may add audio URLs, previews, and inspector controls, but moment titles,
  grouping, evidence counts, and raw-event citation rules should not diverge
  into a second history.
- **Hover/selection** uses `bg-surface`, no border change, and visually connects
  the selected moment to the inspector.
- Skeletons match the compact row shape: mono timestamp, source/title/body
  block, and an optional impact/status block.

### Kanban / board

- Boards are curated work surfaces with explicit board items and user-defined
  stages, not raw saved filters over every matching object. Filters, templates,
  and presets help users start; membership and workflow shape stay intentional.
- Board shortcuts on Home use compact snapshots, not embedded full boards: board
  name, item count, lane counts, and last update. Opening the snapshot enters
  the full board.
- Board creation starts from clear presets with icons, example use cases, and
  editable stages. Presets are starting points, not board types; stages can be
  renamed, reordered, added, or removed during creation and from board settings.
- Board descriptions are user-authored. Preset copy must not appear on the
  board once it has been created unless the user explicitly wrote it.
- Cards `bg-bg border border-border rounded-sm p-3`. Inner padding 12px.
- Card meta strip at the bottom: mono uppercase 10-11px with responsible
  person, due indicator, and priority. Missing values render explicitly
  (`Unassigned`, `No due`, `No priority`) so cleanup work is scannable.
  Due-this-week = `text-signal`; overdue = `text-danger`.
- Card clicks open a board-context detail panel first. The panel shows object
  memory, editable board-local properties, board notes, item history, an object
  preview modal, and direct links to the full object page and object chat.
- Drag uses `@dnd-kit/core` with optimistic `updateBoardItemAction` calls.
- Board moves should feel complete immediately. Show a quiet board-level
  saving state while moves are in flight, then a brief saved confirmation once
  server state catches up. Avoid per-move success toasts on kanban surfaces;
  reserve prominent messaging for failures that need rollback or user action.
- If a move fails, rollback only the failed card and attach the error to that
  card or its column area long enough to be understood. Avoid whole-board
  refresh errors that make it unclear which move failed.

## Iconography

All icons from `lucide-react`. Canonical mapping:

| Nav         | Icon            |
| ----------- | --------------- |
| Home        | `LayoutDashboard` |
| Timeline    | `Clock`         |
| Ask         | `MessageSquare` |
| Work        | `LibraryBig`    |
| Documents   | `Files`         |
| Meetings    | `Video`         |
| Connections | `Cable`         |
| Team        | `Settings`      |

Other recurring icons: `Send` (submit, Telegram connection), `Plug` (legacy integrations label),
`Search` (search inputs),
`Lock`/`Users` (visibility toggle), `Inbox` (empty timeline),
`ChevronsUpDown` (team switcher), `Mail`/`Check`/`X` (invite actions),
`Plus` (create team), `User`/`LogOut` (user menu),
`Sun`/`Moon`/`Monitor` (theme toggle), `Bell` (inbox preview),
`PanelRight` (inspector toggle).

## Motion

- **Approach:** minimal-functional. No springs, no bounces, no shimmer, no
  page transitions.
- **Easing:** `cubic-bezier(0.2, 0, 0, 1)` for all transitions.
- **Duration:** 120ms (pane open/close, menu open/close, dialog), 80ms
  (hover), 0ms (page navigation — prefer skeleton over crossfade).
- `transition-colors` only on interactive elements.
- **Streaming chat indicator:** a single monospace blinking caret `▍` in
  signal color, not a pulsing dot. `animation: blink 0.95s steps(2, end) infinite`.
- `animate-pulse` reserved for skeletons.

## Loading, error & empty states

Every async surface has three states. Build all three.

### Loading — skeletons everywhere

Every Next.js route under `app/` has a sibling `loading.tsx` that renders
a skeleton matching the real page's layout. Skeletons are mandatory.

Primitives in
[apps/web/src/components/loading-states.tsx](apps/web/src/components/loading-states.tsx):

- `<Skeleton />` — base block. `animate-pulse rounded-sm bg-surface-2`.
- `<PageHeaderSkeleton />` — index strip mono one-liner skeleton.
- `<TimelineRowSkeleton />` — compact flat row (ts, source/title/body,
  impact/status).
- `<TimelineFeedSkeleton count={n} />` — N stacked row skeletons.
- `<BoardSkeleton />` — kanban column + card skeletons.
- `<InlineSpinner label="…" />` — small pulsing dot + label for streaming
  micro-loaders (chat).

Rules:

- Skeleton shape must match the real component's shape (same widths,
  column counts).
- Widths are deliberately varied (`w-3/4`, `w-11/12`, etc.) to feel like
  real text, not bars.
- One animation: `animate-pulse`. No shimmer.

### Error — explicit and recoverable

Every route has a sibling `error.tsx`. The shared component is
[`ErrorState`](apps/web/src/components/error-state.tsx): icon, title,
description, optional digest, and a "Try again" button bound to `reset()`.

- Per-route `error.tsx` renders the page header + index strip (so chrome
  doesn't disappear) and then `<ErrorState>` below it.
- Application-wide fallback at
  [`app/app/error.tsx`](apps/web/src/app/app/error.tsx).
- Top-level catastrophic fallback at
  [`app/global-error.tsx`](apps/web/src/app/global-error.tsx) with inline
  styles (runs outside the root layout, so Tailwind won't load).
- Not-found pages use the same shape but with a `SearchX` / `Compass`
  icon and a link back to a safe surface.

### Empty — one mono line

Empty states use a single mono uppercase line with an inline signal-color
action link:

```tsx
<div className="py-10 text-center font-mono text-xs uppercase tracking-[0.12em] text-fg-dim">
  NO EVENTS YET → CAPTURE FROM <a className="text-signal underline">telegram</a>,{' '}
  <a className="text-signal underline">email</a>, OR{' '}
  <a className="text-signal underline">⌘K</a>
</div>
```

No dashed boxes. No paragraphs.

## Accessibility

Non-negotiable. The forensic-archive aesthetic must not come at the cost of
keyboard or assistive-tech users.

### Semantic HTML first

- Prefer real elements: `<button>`, `<nav>`, `<aside>`, `<main>`, `<header>`,
  `<dl>`, `<table>`, `<details>`. Don't put `role="button"` on a `<div>`.
- Headings nest correctly. Every page has exactly one `<h1>` (the page
  title in the index strip's bold first segment, or the object title).
- Lists are `<ul>` / `<ol>` / `<dl>`. The timeline is a `<ol>` of `<li>`,
  not a stack of `<div>`s.
- Icon-only buttons get `aria-label`. Icon buttons with adjacent text get
  `aria-hidden` on the icon.

### Keyboard

- **Every interactive element is reachable by Tab.** No `tabindex="-1"` on
  controls.
- **Focus is always visible.** `:focus-visible` ring uses
  `outline: 2px solid var(--border-strong); outline-offset: 2px` on
  surfaces; signal-color ring on the active CTA. Never `outline: none`
  without a replacement.
- **Global keys:**
  - `⌘K` / `Ctrl+K` — focuses the command bar from anywhere.
  - `Esc` — closes the topmost overlay (dialog → inspector → menu → command bar).
  - `g t` / `g c` / `g o` / `g b` — jump to Timeline / Ask / Objects /
    Boards (direct object/board shortcuts stay available even though Work is
    the primary sidebar parent; registered in
    [apps/web/src/components/keymap.tsx](apps/web/src/components/keymap.tsx)).
- **Citation chip** is a `<button>` (not a link) — Enter / Space opens the
  evidence quick-view dialog or inspector pane. Escape returns focus to the
  chip.
- **Inspector pane** is a `<aside aria-label="Inspector">` with
  `aria-live="polite"` on the body. When opened from a chip click, focus
  moves to the inspector head close button.
- **Rail** items are real anchors (`<a href>`) so they work without JS and
  Cmd+click opens in a new tab. Active item gets `aria-current="page"`.
- **Dialogs / AlertDialogs** — use shadcn (`Dialog`, `AlertDialog`); Radix
  handles focus trap, restore-on-close, and ARIA. Never roll a custom modal.
- **Skip link** — first interactive element on the page is a visually
  hidden `<a href="#main">Skip to main content</a>` that becomes visible
  on focus.

### Color contrast

- `--fg` on `--bg` ≥ 7:1 in both modes (AAA body).
- `--fg-muted` on `--bg` ≥ 4.5:1 (AA body).
- `--fg-dim` on `--bg` ≥ 3:1 — used only for non-essential metadata
  (timestamps next to a chronologically-ordered list). Never put critical
  info (status, error message) in `--fg-dim`.
- `--signal-fg` on `--signal` ≥ 7:1 (the on-signal CTA text).
- `--danger` on `--bg` ≥ 4.5:1.
- **Do not rely on color alone.** Overdue items get the danger color AND
  the word "OVERDUE" in mono. Due-this-week gets signal AND the relative
  date. Active nav gets signal AND the 2px left bar AND `aria-current`.

### Citation chips and screen readers

The citation chip's `[c:1923]` brackets are typographic, but screen readers
should hear "citation 1923, source email":

```tsx
<button
  aria-label={`Citation ${id}, source ${source}. Press Enter to view source.`}
  aria-haspopup="dialog"
  aria-expanded={previewOpen}
  aria-controls="evidence-preview"
>
  <span aria-hidden="true">[c:{id}]</span>
</button>
```

The dialog or inspector pane that opens has a plain-language title and returns
focus to the triggering chip on close.

### Index strips and metadata

Mono uppercase text reads as shouting to some screen readers. The
`<IndexStrip>` component wraps each segment so SR users hear
sentence-case:

```tsx
<header aria-label="Timeline summary">
  <span className="font-mono uppercase">
    <span aria-hidden="true">EVENTS · 2,847 · 14d · acme</span>
    <span className="sr-only">2,847 events in the last 14 days for team acme.</span>
  </span>
</header>
```

Same pattern for object meta strips, kanban column counts, inspector
key/value pairs.

### Forms

- Every `<input>` / `<textarea>` / `<select>` has a `<Label htmlFor>` from
  shadcn — visible by default. Use `sr-only` on the label only for the
  command bar (where the placeholder + ⌘K affordance carries the meaning).
- Inline error text uses `id={`${fieldId}-error`}` and the input gets
  `aria-describedby={`${fieldId}-error`} aria-invalid="true"`.
- Disabled state uses `aria-disabled` plus a visual cue beyond opacity
  (e.g., `cursor-not-allowed`, no signal color on a disabled CTA).

### Loading, error, empty states

- Skeletons render `aria-busy="true"` on the parent + `aria-label="Loading"`.
  Animation respects `prefers-reduced-motion: reduce` — skeletons stop
  pulsing, just hold a flat tint.
- Error states use a real `<h2>` for the title and the retry button is a
  real `<button>`. `role="alert"` on the wrapper for hard errors.
- Streaming chat caret has `aria-live="polite"` on the container; the
  caret itself is `aria-hidden`.

### Optimistic updates

- Lightweight, reversible product edits should update the local surface
  immediately, then reconcile with server state: kanban moves, board item adds,
  board item responsible/due/priority/notes edits, object status/stage/priority/due
  edits, object notes, relationship changes, object-change approvals, object
  archive state after explicit user confirmation, document renames, document
  folder create/delete, text capture, calendar create/edit, document upload
  placeholders, onboarding checklist actions, and inbox read-state changes.
  Approval accept/reject may optimistically remove only the affected review row
  when the action is reversible in the UI; restore the row and show a local
  error if the server rejects the change.
- Security-sensitive or external-provider actions wait for server
  confirmation: invites, meeting bot scheduling/cancel, exports, OAuth/
  integration setup, and irreversible destructive operations.
- Success feedback should be quiet and local (`Saving...` then `Saved`).
  Use prominent alerts only for failures, and rollback the smallest affected
  thing so the user can tell what changed.

### Embedded approvals

- On pages where approvals are not the primary job, approval sections collapse
  by default behind a `<details>` summary with a live pending count. Calendar,
  object detail, and object cleanup suggestions should expose the review path
  without pushing the main page content below a stack of approval rows.
- The dedicated Approvals page remains expanded and optimized for scanning,
  filtering, bulk accept, and row-level review. Embedded approval panels may
  expose bulk reject when multiple visible proposals need cleanup, but avoid
  bulk accept paths that can apply state from a narrow context.

### Object detail

- Connected Work sits above Evidence as live context, not accepted memory. It
  uses compact grouped lists for open tasks, calendar, people/objects, boards,
  pending approvals, recent history, documents, shared links, and captured
  files. Do not repeat related raw events here; the Evidence panel is the
  object page's canonical event-level source browser.
- Provenance is a compact vertical disclosure, not a three-column evidence
  dump. Show one creation source and at most two accepted changes initially;
  keep related evidence collapsed. Every group shows its source count, and
  expanded remainders use a bounded scroll region with links to the Timeline.
- Raw event bodies never become unbounded provenance headings. Use the same
  whitespace-normalized 160-character preview as other compact references,
  keep complete source content in the Timeline inspector/Evidence surface, and
  avoid serializing a second full copy into object provenance. Object Evidence
  cards cap source text at five lines and open the shared evidence quick-view;
  its content scrolls independently so the full-page action remains visible.
- Person object sidebars show saved email and phone identity facets in a compact
  Contact panel. These are accepted object memory, not Related Context cards;
  shared links remain the artifact-style related context.
- Repair Memory is a quiet header action. It queues focused object cleanup,
  fact-backed relationship proposals, and conservative missing-person bundles.
  It should not imply that rejected duplicate pairs or rejected relationship
  edges will be resuggested.
- Object-scoped pending approvals show only items that target the object plus
  dependent bundle items required by those proposals. A missing-person
  relationship proposal should read as a create-person row plus a named
  relationship row, not as raw refs or UUID endpoints.

### Motion

- All transitions and animations gate on
  `@media (prefers-reduced-motion: no-preference)`. Under
  `prefers-reduced-motion: reduce`, animations resolve to opacity 0→1 or
  instant state changes.
- The streaming caret blink stops under reduced-motion — replace with a
  static "…" character.

### Density and zoom

- Body text is 14px minimum; `xs` 12px reserved for mono metadata.
- All layouts work at 200% browser zoom without horizontal scroll
  (responsive: rail collapses, inspector collapses to a sheet, main column
  reflows).
- `text-size-adjust: 100%` on `<html>` so iOS doesn't autoscale.

### Testing checklist (every new surface)

1. Tab through the page top to bottom — every interactive element has a
   visible focus ring and a sensible order.
2. Use VoiceOver (Cmd+F5 on macOS) or NVDA — read the page from the top.
   Citation chips, status, and metadata announce in plain language.
3. Disable CSS — the semantic HTML alone tells the story (headings,
   lists, buttons, links).
4. Resize to 320px wide and 200% zoom — no horizontal scroll, no clipped
   content.
5. Set OS to "reduce motion" — animations stop.
6. Check contrast in browser devtools — every text/bg pair hits the
   thresholds above.

## Rules

- No emojis in product UI.
- No background gradients.
- No drop shadows.
- All icons from `lucide-react`.
- One primary (signal lime) CTA per view. Never two.
- One chromatic accent in the system. Never introduce a second hue.
- Theme follows OS by default. Manual toggle persists per-user in
  `localStorage` under `tl-theme`.
- Selection color uses `--signal-soft`.
- Every **operational** list/feed/board opens with an index strip, not a
  soft eyebrow + title + subtitle stack. **Standard** pages open with
  `<PageHeader>` (sentence-case `<h1>` + optional subtitle + optional mono
  metadata strip). See the surface split under Layout.
- Mono is mandatory for: timestamps, IDs, citations, status codes,
  metadata strips, keyboard shortcuts, code, file paths, hashes.

## Adding a shadcn component

1. Visit [ui.shadcn.com](https://ui.shadcn.com), pick the New York variant.
2. Copy the component file(s) into `apps/web/src/components/ui/`.
3. Make sure required Radix package is in `apps/web/package.json`.
4. **Retune the variants:** `rounded-sm` instead of `rounded-md`, no
   shadow, signal-color used only where the spec calls for a primary CTA.
5. Import via `@/components/ui/<name>`.

No `shadcn` CLI is required to be installed or run.

## Decisions log

| Date       | Decision                                                                   | Rationale                                                                                |
| ---------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| 2026-05-25 | v2 reset — Operational Archive direction                                   | Created by /design-consultation. v1 was generic; v2 makes the citation story structural. |
| 2026-05-25 | OKLCH tokens, class-based `.dark`, next-themes manual toggle + OS default  | Matches Linear's 2026 move; enables manual override on shared machines.                  |
| 2026-05-25 | Switzer + Commit Mono, free-only stack                                     | Procurement-free, ships immediately. Mono is load-bearing; sans is secondary.            |
| 2026-05-25 | Acid lime signal (`oklch(0.90 0.20 130)` dark)                             | Refuses the blue / violet trap. Polarizing on purpose.                                   |
| 2026-05-25 | Three-pane shell, 56px icon rail, right inspector                          | Makes the "every claim is cited" promise structural.                                     |
| 2026-06-01 | Desktop sidebar defaults expanded and folds to the icon rail               | Keeps team context and labels visible while preserving the dense rail mode.              |
| 2026-05-25 | Timeline loses card chrome                                                 | Lets the timeline scale to thousands of events without visual clutter.                   |
| 2026-06-18 | Surface split — operational keeps `IndexStrip`, standard gets `PageHeader` | Stops non-technical "needs a degree" fatigue on settings/hubs while keeping the forensic timeline. |
