# The Timeline — Design System

**Version:** v2 · Operational Archive (2026-05-25). Replaces the v1
warm-neutral + amber direction.

The single source of truth for the visual design of the product. Every
component and page follows this. If a screen disagrees, fix the screen.

## Memorable thing

**The operations log your team can talk to.** A precision instrument that
feels forensic where it matters and quiet everywhere else. Bloomberg Terminal
× git log × Linear. Every timestamp, every ID, every citation is first-class
type. The product's differentiator — _every claim the agent makes is cited
back to a raw event_ — is structurally visible, not implied.

This is **not** a Notion / Mem / Reflect re-skin. It is an instrument panel
for "what did the team do and how do you know?"

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
- **Page title:** `text-2xl font-semibold tracking-tight` (Switzer 600,
  letter-spacing -0.02em).
- **Metadata one-liner** (index strip): `text-xs font-mono uppercase tracking-[0.12em] text-fg-muted`.
- **Long-form note / doc body:** Switzer 400, 16px, line-height 1.65, max
  `60ch` width.

## Layout — three-pane, density-variable

Departs from the v1 centered `max-w-3xl` prose column. New shell:

```
┌─────┬──────────────────────────────────┬─────────────────┐
│ 56px│   command bar  (⌘K, always on)   │  inspector pane │
│ rail│ ─────────────────────────────────│  (collapsible)  │
│     │   index strip                    │                 │
│  ▣  │   EVENTS · 2,847 · 14d · acme    │  citation src   │
│  ▦  │ ─────────────────────────────────│  raw event JSON │
│  ◧  │   feed / board / object / chat   │  related links  │
│  ◑  │                                  │                 │
└─────┴──────────────────────────────────┴─────────────────┘
```

- **Left rail** (`w-14` = 56px default, expand to `w-60` = 240px on hover
  or pin): icon-only nav with monospace section glyphs. No labels by
  default; tooltip on hover. Active route shows a 2px signal-color bar at
  its left edge plus `bg-surface-2 text-signal`.
- **Main column** fills available width. **No `max-w-3xl` artificial
  column** except long-form prose surfaces (single document view, single
  note view) — those wrap in a `<ProseContainer>` that sets `max-w-prose`.
- **Right inspector pane** (`w-80` = 320px, collapsible to 0): shows
  citation source, raw event JSON, related objects, audit trail. Hidden by
  default; opens when the user clicks a citation chip, an object
  reference, or the inspector toggle. This pane is the structural
  expression of "every claim is cited."
- **Command bar** persistent across the top of the main column. Cmd+K
  focuses. The product's center of gravity is search/jump/ask, not the
  sidebar.

### Density

- `--row-h-compact` = 28px (board rows, dense table rows)
- `--row-h-standard` = 36px (nav items, list rows, table rows)
- `--row-h-comfortable` = 48px (mobile, primary nav, settings forms)

Linear-tight on operational surfaces. Comfortable on mobile and on forms.

## Components

### Primary symbols

- **Citation chip** — `<CitationChip id="c:1923" />`. Monospace,
  signal-color foreground on `--signal-soft` background, 1px signal-tinted
  border, `rounded-sm` (2px), literal brackets in the text. Hover/click
  opens the inspector pane with the raw event source. This is the
  product's primary visual symbol — it should be recognizable from a
  thumbnail.
- **Index strip** — `<IndexStrip />`. A mono uppercase one-liner replacing
  decorative page headers: `EVENTS · 2,847 TOTAL · LAST 14d · TEAM acme · FILTER →`.
  Top + bottom hairline border. Inspired by `git log --stat` and Bloomberg
  terminal header bars.
- **Setup checklist** — `<TimelineOnboardingChecklist />`. A dense,
  dismissible tutorial panel at the top of `/app/timeline`. It uses a
  hairline-bounded header, mono progress counter, and five equal cells for
  capture surfaces. Completion uses the signal accent; incomplete steps stay
  neutral.
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

- **Flat indexed feed, no cards.** Each event is a row, not a card. Row =
  `grid grid-cols-[18ch_1fr_9ch] gap-4 py-3 border-b border-border`.
- **Mono timestamp** in the left column: `font-mono text-xs text-fg-dim`.
- **Body** in the middle column: speaker in `text-fg font-medium`, quote
  in `text-fg-muted`. Citations inline.
- **Source label** in the right column: mono uppercase 11px, signal color
  when the event is live/streaming.
- **Hover** lifts the row with `bg-surface`, no border change.
- Skeletons match: `<Skeleton className="h-4 w-[18ch]" />` for ts,
  `<Skeleton className="h-4 w-3/4" />` for body, `<Skeleton className="h-3 w-[9ch]" />` for source.

### Kanban / board

- Cards `bg-bg border border-border rounded-sm p-3`. Inner padding 12px.
- Card meta strip at the bottom: mono uppercase 11px with task ID,
  assignee, due indicator. Due-this-week = `text-signal`; overdue =
  `text-danger`.
- Drag uses `@dnd-kit/core` with optimistic `updateObjectAction` calls.

## Iconography

All icons from `lucide-react`. Canonical mapping:

| Nav         | Icon            |
| ----------- | --------------- |
| Capture     | `Plus`          |
| Timeline    | `Clock`         |
| Chat        | `MessageSquare` |
| Objects     | `Boxes`         |
| Boards      | `LayoutGrid`    |
| Calendar    | `CalendarDays`  |
| Approvals   | `CircleCheckBig` |
| Documents   | `FileText`      |
| Inbox       | `Inbox`         |
| Team        | `Settings`      |

Other recurring icons: `Send` (submit, Telegram connection), `Cable` (integrations),
`Search` (search inputs),
`Lock`/`Users` (visibility toggle), `Inbox` (empty timeline),
`ChevronsUpDown` (team switcher), `Mail`/`Check`/`X` (invite actions),
`Plus` (create team), `User`/`LogOut` (user menu),
`Sun`/`Moon`/`Monitor` (theme toggle), `PanelRight` (inspector toggle).

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
- `<TimelineRowSkeleton />` — three-column flat row (ts, body, source).
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
  - `g t` / `g c` / `g o` / `g b` — jump to Timeline / Chat / Objects /
    Boards (vim-style leader, registered in
    [apps/web/src/components/keymap.tsx](apps/web/src/components/keymap.tsx)).
- **Citation chip** is a `<button>` (not a link) — Enter / Space opens the
  inspector pane and moves focus into it. Escape returns focus to the chip.
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
  aria-expanded={inspectorOpen}
  aria-controls="inspector-pane"
>
  <span aria-hidden="true">[c:{id}]</span>
</button>
```

The inspector pane that opens has `aria-labelledby="inspector-title"` and
the title element reads the citation ID in plain language.

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
- Every list/feed/board opens with an index strip, not a soft eyebrow +
  title + subtitle stack.
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
| 2026-05-25 | Timeline loses card chrome                                                 | Lets the timeline scale to thousands of events without visual clutter.                   |
