# The Timeline — Design System

The single source of truth for the visual design of the product. Every component
and page should follow this. If a screen disagrees with this file, fix the screen.

## Brand and voice

- Low-friction, calm, trustworthy.
- Visual feel: clean, monochromatic with one warm accent, generous whitespace,
  prose-friendly.
- Tone in copy: short sentences, no exclamation marks, no marketing fluff. The
  product is a tool, not a celebration.

## Stack

- **Tailwind v4** (`@tailwindcss/postcss`) — no `tailwind.config.js`; tokens live
  in CSS via `@theme` directive.
- **shadcn/ui** — New York style, copied into `apps/web/src/components/ui/`. No
  CLI dependency at runtime; new components are added by hand-copying from
  [ui.shadcn.com](https://ui.shadcn.com).
- **Radix primitives** for headless interactive behavior.
- **lucide-react** for all icons. No other icon libraries.

## Color tokens

CSS variables in `apps/web/src/app/globals.css`. Neutral base is `zinc`; the
accent is a single warm tone (`amber-600`-ish) used only for the primary CTA on
a view.

Light mode:

```css
--background: 0 0% 100%;
--foreground: 240 10% 3.9%;
--card: 0 0% 100%;
--card-foreground: 240 10% 3.9%;
--popover: 0 0% 100%;
--popover-foreground: 240 10% 3.9%;
--primary: 35 95% 45%; /* amber */
--primary-foreground: 0 0% 100%;
--secondary: 240 4.8% 95.9%;
--secondary-foreground: 240 5.9% 10%;
--muted: 240 4.8% 95.9%;
--muted-foreground: 240 3.8% 46.1%;
--accent: 240 4.8% 95.9%;
--accent-foreground: 240 5.9% 10%;
--destructive: 0 84.2% 60.2%;
--destructive-foreground: 0 0% 98%;
--border: 240 5.9% 90%;
--input: 240 5.9% 90%;
--ring: 35 95% 45%;
--radius: 0.5rem;
```

Dark mode mirrors with inverted neutrals; same accent hue.

## Typography

- `next/font` Geist Sans (body) + Geist Mono (code, IDs, timestamps).
- Body 15px (`text-[15px] leading-7`).
- Type scale: `text-xs / sm / base / lg / xl / 2xl / 3xl`.
- Long-form content enables ligatures: `font-feature-settings: 'rlig' 1, 'calt' 1;`.

## Spacing and layout

- Default 4px grid.
- Page max-widths:
  - `max-w-3xl` for content (timeline, settings).
  - `max-w-6xl` for app shell.
- App shell: sticky top bar (logo · team switcher · user menu), centered
  content column, no left nav in v1.

## Components

- **Buttons** — one primary per view. Everything else is `variant="ghost"` or
  `"outline"`.
- **Forms** — shadcn `Input`, `Textarea`, `Label`; `react-hook-form` + `zod`
  for validation. Inline error text under fields.
- **Empty states** — one short helpful sentence, never a wall of text.
- **Lists vs tables** — the timeline is a list of cards, not a table. Tables
  only for dense settings views (members list).
- **Cards** — use `Card` for grouped content; no gratuitous nesting.

## Motion

- No animation by default.
- `transition-colors` only on interactive elements (buttons, links, menu items).
- No skeleton loaders in Phase 1; pages are server-rendered.

## Rules

- No emojis in product UI.
- No background gradients.
- No drop shadows beyond shadcn defaults.
- All icons from `lucide-react`.
- Dark mode follows OS preference via `prefers-color-scheme`. No manual toggle
  in Phase 1.

## Adding a shadcn component

1. Visit [ui.shadcn.com](https://ui.shadcn.com), pick the New York variant.
2. Copy the component file(s) into `apps/web/src/components/ui/`.
3. Make sure required Radix package is in `apps/web/package.json`.
4. Import via `@/components/ui/<name>`.

No `shadcn` CLI is required to be installed or run.
