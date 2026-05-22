# The Timeline — Design System

The single source of truth for the visual design of the product. Every component
and page should follow this. If a screen disagrees with this file, fix the
screen.

## Brand and voice

- Low-friction, calm, trustworthy.
- Visual feel: warm-neutral surfaces, generous whitespace, prose-friendly. One
  warm amber accent used sparingly for primary actions.
- Tone in copy: short sentences, no exclamation marks, no marketing fluff. The
  product is a tool, not a celebration.

## Stack

- **Tailwind v4** (`@tailwindcss/postcss`) — no `tailwind.config.js`; tokens
  live in CSS via `@theme` directive in
  [apps/web/src/app/globals.css](apps/web/src/app/globals.css).
- **shadcn/ui** — New York style, copied into `apps/web/src/components/ui/`. No
  CLI dependency at runtime; new components are added by hand-copying from
  [ui.shadcn.com](https://ui.shadcn.com).
- **Radix primitives** for headless interactive behavior.
- **lucide-react** for all icons. No other icon libraries.

## Color tokens

Tokens are HSL values defined in `:root` (and overridden under
`@media (prefers-color-scheme: dark)`). The neutral base is a slightly warm zinc
on an off-white background so cards register as paper, not bleed-edges. The
accent is a single warm amber used only for the primary CTA on a view.

Light mode (canonical):

```css
--background: 40 14% 97%;        /* warm off-white */
--foreground: 240 10% 8%;
--card: 0 0% 100%;
--primary: 30 90% 42%;           /* amber */
--primary-foreground: 40 30% 98%;
--secondary: 240 5% 95%;
--muted: 240 5% 95%;
--muted-foreground: 240 4% 42%;
--border: 240 6% 89%;
--ring: 30 90% 42%;
--radius: 0.75rem;               /* 12px */
```

Dark mode inverts neutrals with a deep `240 10% 5%` background and a slightly
brighter amber. Dark mode follows OS preference via `prefers-color-scheme`. No
manual toggle in Phase 1.

Radius scale (declared in `@theme`):

- `--radius-sm` = `radius - 4px` (4px) — tiny chips, badges.
- `--radius-md` = `radius - 2px` (6px) — inputs, buttons.
- `--radius-lg` = `--radius` (12px) — cards.
- `--radius-xl` = `radius + 4px` (16px) — hero surfaces (capture box, search,
  chat composer).

## Typography

- `next/font` Geist Sans (body) + Geist Mono (code, IDs, timestamps).
- Body 15px / `line-height: 1.65` set on `<body>`.
- Type scale: `text-xs / sm / base / lg / xl / 2xl / 3xl`.
- Long-form rendering enables ligatures via
  `font-feature-settings: 'rlig' 1, 'calt' 1;` on `<body>`.
- Page titles: `text-3xl font-semibold tracking-tight`.
- Eyebrow label above titles: `text-xs uppercase tracking-[0.16em] text-muted-foreground`.

## Layout — two-pane shell

The canonical app structure is a **two-pane shell** rendered by
[apps/web/src/components/app-shell.tsx](apps/web/src/components/app-shell.tsx):

```
┌──────────────────────────────────────────────────────────┐
│  sidebar  │  top bar: user menu                          │
│  256px    ├──────────────────────────────────────────────┤
│           │                                              │
│  brand    │   page header (eyebrow · title · subtitle)   │
│           │                                              │
│  · Time   │   primary content (max-w-3xl, centered)      │
│  · Chat   │                                              │
│  · Ents   │                                              │
│  · Team   │                                              │
│           │                                              │
│  ─────    │                                              │
│  team sw. │                                              │
└───────────┴──────────────────────────────────────────────┘
```

- **Sidebar** (`w-64`, `md:flex`): brand mark at top, primary nav in the middle,
  team switcher at the bottom. Below the `md` breakpoint the sidebar collapses
  behind a hamburger button in the top bar that opens a slide-over sheet with
  the same content (see
  [`mobile-nav.tsx`](apps/web/src/components/mobile-nav.tsx)).
- **Nav items**: each row is `flex items-center gap-3 rounded-md px-3 py-2
  text-sm`; lucide icon left of label. Active route uses `bg-accent
  text-foreground`; inactive uses `text-muted-foreground hover:bg-accent/60
  hover:text-foreground`.
- **Top bar** (`h-16`): only the user menu (right-aligned). Mobile shows the
  brand mark on the left.
- **Main column**: `max-w-3xl` centered; outer padding `px-6 py-10` (mobile),
  `md:px-10 md:py-14`.
- **Shell max width**: `max-w-[1400px]` so the layout doesn't sprawl on ultra-wide
  displays.

### Page header pattern

Every top-level page opens with:

```tsx
<header className="mb-10">
  <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Section</p>
  <h1 className="mt-2 text-3xl font-semibold tracking-tight">Page title</h1>
  <p className="mt-2 text-sm text-muted-foreground">One-line subtitle.</p>
</header>
```

## Spacing and rhythm

- 4px base grid.
- Page header → content: `mb-10` after the header.
- Section → section within a page: `mt-10` between major sections.
- Feed lists (timeline, entity events): `space-y-4`.
- Grid layouts: `gap-3` or `gap-4`.
- Cards: standard internal padding `p-6`. Empty/dense list cells: `px-4 py-3`.
- Surrounding form fields inside a card: `space-y-5`.

## Components

- **Cards** — `rounded-xl border bg-card`. No drop shadows in feed cards. Hero
  surfaces (capture, search, composer) may use `rounded-xl` with a subtle
  `shadow-sm` if they need lift.
- **Buttons** — one primary per view (amber). Everything else is
  `variant="ghost"` or `"outline"`. Pill toggles (e.g. visibility) use
  `rounded-full border px-3 py-1.5 text-xs` with an icon.
- **Forms** — shadcn `Input`, `Textarea`, `Label`; inline error text under
  fields. The capture textarea is intentionally chrome-less inside its card
  (no border, no shadow, no padding) so the card itself is the input surface.
- **Inputs with affordances** — search and chat composer wrap an `<input>` in a
  relative div with a `lucide` icon absolutely-positioned left and a primary
  action button absolutely-positioned right.
- **Chat bubbles** — user messages right-aligned with `bg-secondary` rounded
  bubble; assistant messages left-aligned with a 2px amber left border, no
  background. Role label above each bubble: `text-[10px] uppercase
  tracking-[0.14em] text-muted-foreground`.
- **Composer** — sticky at the bottom of the main column
  (`sticky bottom-6`), `rounded-xl border bg-card`, send button absolutely
  positioned inside the input as a 40px primary square.
- **Empty states** — centered in a dashed-border rounded-xl container with a
  lucide icon and one short helpful sentence. Never a wall of text.
- **Filters** — collapsed by default behind a `<details>` summary; expand into
  an inline `rounded-lg border bg-card p-4` panel.
- **Lists vs tables** — the timeline is a list of cards, not a table. The
  entities index is a 2-column grid of compact rows on `sm+`. Tables only for
  dense settings views (members list).
- **Avatars** — squared (`rounded-md` for teams, `rounded-full` for people),
  `bg-primary/12 text-primary`, monogram from initials. Never load image
  avatars in Phase 1.

## Iconography

All icons from `lucide-react`. Canonical sidebar mapping:

| Nav      | Icon            |
| -------- | --------------- |
| Timeline | `Clock`         |
| Chat     | `MessageSquare` |
| Entities | `Users`         |
| Team     | `Settings`      |

Other recurring icons: `Send` for submit buttons, `Search` for search inputs,
`Lock` / `Users` for visibility toggle, `Inbox` for empty timeline,
`ChevronsUpDown` for the team switcher, `User` / `LogOut` for the user menu.

## Loading, error & empty states

Every async surface has three states. Build all three.

### Loading — skeletons everywhere

Every Next.js route under `app/` has a sibling `loading.tsx` that renders a
skeleton matching the real page's layout. Skeletons are not optional. They
preserve hierarchy, keep CLS to zero, and tell the user "this is the timeline,
it's filling in" rather than "is anything happening?"

Primitives in
[apps/web/src/components/loading-states.tsx](apps/web/src/components/loading-states.tsx):

- `<Skeleton />` ([ui/skeleton.tsx](apps/web/src/components/ui/skeleton.tsx)) —
  base block. `animate-pulse rounded-md bg-muted/70`.
- `<PageHeaderSkeleton />` — eyebrow + title + subtitle in correct sizes.
- `<CardSkeleton />` — single feed card skeleton (avatar + meta + 3 text lines).
- `<TimelineFeedSkeleton count={n} />` — N stacked card skeletons.
- `<EntityGridSkeleton count={n} />` — 2-col compact row grid.
- `<InlineSpinner label="…" />` — small pulsing dot + label for in-page
  micro-loaders (e.g. streaming chat).

Rules:

- Skeleton shape must match the real component's shape (same heights, widths,
  column counts). Don't ship a generic three-bar fallback.
- Skeleton widths are deliberately varied (`w-3/4`, `w-11/12`, etc.) to feel
  like real text, not bars.
- Use `bg-muted/70` (light) / `bg-muted/40` (dark). Never use opaque grey.
- One animation: `animate-pulse`. No shimmer, no wave.

### Error — explicit and recoverable

Every route has a sibling `error.tsx`. The shared component is
[`ErrorState`](apps/web/src/components/error-state.tsx): icon, title,
description, optional digest, and a "Try again" button bound to `reset()`.

- Per-route `error.tsx` renders the page header (so the chrome doesn't
  disappear) and then `<ErrorState>` below it.
- Application-wide fallback lives at
  [`app/app/error.tsx`](apps/web/src/app/app/error.tsx).
- Top-level catastrophic fallback lives at
  [`app/global-error.tsx`](apps/web/src/app/global-error.tsx) with inline
  styles (it runs outside the root layout, so Tailwind classes won't load
  reliably).
- Not-found pages use the same shape as `ErrorState` but with a `SearchX` /
  `Compass` icon and a link back to a safe surface.

### Empty — one friendly sentence

Empty states use a dashed-border rounded-xl container with a lucide icon and a
single sentence. Never a wall of text. The timeline's empty state uses `Inbox`;
entities not-found uses `SearchX`.

## Motion

- No animation by default.
- `transition-colors` only on interactive elements (buttons, links, menu items,
  pill toggles).
- `animate-pulse` is reserved for skeletons and the streaming-indicator dot. No
  shimmer effects, no spinners with rotating SVGs.

## Rules

- No emojis in product UI.
- No background gradients.
- No drop shadows beyond `shadow-sm` on hero surfaces.
- All icons from `lucide-react`.
- One primary (amber) CTA per view.
- Dark mode follows OS preference via `prefers-color-scheme`. No manual toggle
  in Phase 1.
- Selection color uses `hsl(var(--primary) / 0.18)` — set in `globals.css`.

## Adding a shadcn component

1. Visit [ui.shadcn.com](https://ui.shadcn.com), pick the New York variant.
2. Copy the component file(s) into `apps/web/src/components/ui/`.
3. Make sure required Radix package is in `apps/web/package.json`.
4. Import via `@/components/ui/<name>`.

No `shadcn` CLI is required to be installed or run.
