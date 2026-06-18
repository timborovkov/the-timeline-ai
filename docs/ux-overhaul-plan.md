# UX Overhaul Plan

Direction chosen: **soften the surface.** Keep the forensic mono treatment
for *data* (timestamps, IDs, citations, status codes, metadata strips,
keyboard shortcuts). Replace mono-uppercase eyebrows and `IndexStrip`
headers with normal sentence-case headers on non-operational pages. The
Operational Archive brand stays; it just stops shouting on every page.

This plan addresses: "ugly and messy," "very hard to understand and read,"
"a lot of texts, random labels," "UX is not clean," "hard for
non-technical users," "connecting things is confusing," "some things seem
hidden," "some things seem broken," "feels like you need a degree."

Root causes confirmed in code:

- `design.md` mandates mono-uppercase eyebrow labels + an `IndexStrip`
  (`HOME · team acme · recent 12 · attention 2`) on every page. That is the
  "wall of labels / needs a degree" feeling by design.
- The connect flow exposes raw internal vocabulary (`provider`,
  `externalId`, `resourceKind`, kinds like `github.org` / `linear.team`,
  "Personal connections" vs "Team sources", "Activate / Save / Replace
  connection", "resource shares", "Expose as MCP", `cachedTools`,
  `authType`). See
  [`components/integrations/provider-connections.tsx`](../apps/web/src/components/integrations/provider-connections.tsx),
  [`components/integrations/connected.tsx`](../apps/web/src/components/integrations/connected.tsx).
- One logical goal ("connect Drive") spans 3+ surfaces and 2 roles:
  Sources hub → `team/integrations` (catalog + OAuth) → `me/connections`
  (owner shares) → back to `team/integrations` (admin activates). Personal
  vs team is exposed as navigation, not as wizard steps.
- Three parallel systems (native integrations, MCP servers,
  provider-connections / resource-shares) sit on one page with no
  explanation of what "MCP" is. The empty state tells non-technical users
  to "add the provider credentials in env."
  ([`app/app/team/integrations/page.tsx`](../apps/web/src/app/app/team/integrations/page.tsx))
- "Needs reconnect" is a label with no button
  ([`provider-connections.tsx:216`](../apps/web/src/components/integrations/provider-connections.tsx));
  errors are raw `res.text()` in dialogs
  ([`catalog.tsx:24`](../apps/web/src/components/integrations/catalog.tsx));
  `lastError` has no retry CTA
  ([`connected.tsx:84`](../apps/web/src/components/integrations/connected.tsx)).
- Audit log, Job recovery, Personal connections, Personal MCP,
  Expose-as-MCP are tiny secondary chips on one action bar; Calendar
  subscription and MCP share are separate sub-pages reachable only via
  those chips. The evidence inspector is hidden by default and opens only
  on citation-chip click — a relationship a new user may never discover.

## Principles and guardrails

- **`design.md` is the source of truth.** Every visual change updates
  `design.md` in the same PR (repo guardrail). If a screen disagrees, fix
  the screen; if the design language is intentionally evolving, update the
  doc too.
- **One primary CTA per view. One chromatic accent. No new hues.** No
  gradients, no shadows, `rounded-sm`, lucide icons only.
- **Keep raw IDs / timestamps mono** and put them in the inspector for
  power users. Never surface `externalId` / `resourceKind` / `.org` kinds
  in pickers or primary labels for non-technical users.
- **Team isolation, AES-GCM secrets, MCP output fencing, and the SSRF
  guard stay untouched.** This plan is UI/flow only; no data-model,
  scope-bypass, or trust-boundary changes.
- **`pnpm` only.** Completion gates per `AGENTS.md`: `pnpm validate`,
  `pnpm run doctor` (score 100), and the nearest targeted tests.

## Surface split (the core idea)

| Surface kind | Pages | Header treatment |
| --- | --- | --- |
| Operational | Timeline, Approvals, Jobs, Audit, Objects list, Boards | Keep `IndexStrip` + mono eyebrows. Dense, terminal-grade. |
| Standard | Home, Sources, Documents, Team, Integrations, Connections, Calendar, Meetings, Me | New `<PageHeader title subtitle>` + sentence-case `<SectionHeading>`. Mono reserved for data. |

This lets the product keep its differentiator (forensic timeline) without
making every settings page look like a terminal.

## Phase U1 — Design-language softening (foundation)

Evolve tokens/components so standard pages stop looking like a terminal.
Must land first; every later phase depends on the new primitives.

- Update `design.md`: add the surface split above; update "Layout,"
  "Components," and "Patterns" so standard pages use `PageHeader` +
  `SectionHeading`, operational pages keep `IndexStrip` + mono eyebrows.
- New `components/page-header.tsx`: `<H1>` (Switzer 600, `text-2xl
  tracking-tight`) + optional `subtitle` (`text-sm text-fg-muted`) +
  optional mono metadata one-liner for data (counts, IDs). One `<h1>` per
  page.
- New `components/section-heading.tsx`: sentence-case `<H2>` (`text-sm
  font-semibold text-fg`), not mono uppercase. Optional right-aligned
  action slot.
- Keep `components/index-strip.tsx` for operational surfaces only.
- Swap headers on standard pages:
  [`app/app/page.tsx`](../apps/web/src/app/app/page.tsx) (Home),
  [`app/app/sources/page.tsx`](../apps/web/src/app/app/sources/page.tsx),
  [`app/app/documents/page.tsx`](../apps/web/src/app/app/documents/page.tsx),
  [`app/app/team/page.tsx`](../apps/web/src/app/app/team/page.tsx),
  [`app/app/team/integrations/page.tsx`](../apps/web/src/app/app/team/integrations/page.tsx),
  `app/app/team/{slack,telegram,mcp-servers,mcp-share}.tsx`,
  `app/app/me/connections/page.tsx`,
  `app/app/me/mcp-servers/page.tsx`,
  `app/app/calendar/page.tsx`,
  `app/app/meetings/page.tsx`.
- Replace mono-uppercase section eyebrows in those pages with
  `<SectionHeading>` (e.g. "Quick actions", "Recent moments", "Daily
  digest", "Native integrations", "MCP servers", "Connected",
  "Organizations", "Sources").
- Accessibility: keep exactly one `<h1>` per page; heading order stays
  valid; mono metadata strips keep `sr-only` sentence-case per
  `design.md`.

**Acceptance:** standard pages render a normal `H1` + sentence-case
section headings; operational surfaces are unchanged; `design.md` matches
shipped code; `pnpm validate` + `pnpm run doctor` 100; before/after
screenshots in the PR.

## Phase U2 — Connect-flow wizard (the "connecting things is confusing" fix)

One guided flow per provider; hide raw IDs; fold the personal/team split
into steps.

- New route `app/app/connections/[provider]/connect` (or a routed modal)
  with three steps:
  1. **Connect** — OAuth via the existing `POST /api/integrations/[id]/start`.
  2. **Choose what to capture** — friendly multi-select of the owner's
     resources (orgs / teams / repos / drives), backed by the existing
     `GET/PUT /api/connections/[id]/resources`.
  3. **Done** — "Here's what's syncing," with a link to the Connections
     overview and to the inspector for raw IDs.
- Hide `externalId`, `resourceKind`, and `.org` kinds behind human labels
  ("GitHub · acme-inc", "Linear · Engineering", "Google Drive · Shared
  Drives"). Raw IDs live in the inspector only.
- Fold `me/connections` (owner shares) and `team/integrations` (admin
  activates) into the wizard. Keep the role gate inline and human: when
  owner ≠ admin, show "An admin needs to approve these sources" with a
  one-click **Request approval**; when owner == admin (solo teams), skip
  the extra step.
- Rebuild `components/integrations/provider-connections.tsx` picker as a
  plain multi-select list with human names, checkboxes, and a selected
  count. Remove the `resource.kind` mono tag from the row.
- Move **Expose as MCP** (outbound, Timeline-as-MCP-server) out of the
  inbound-connect page → its own card under Team. It is a different
  feature and conflates two concepts today.
- Collapse the five-link jargon action bar
  (`team/integrations/page.tsx:108`) into a single **Advanced**
  `<details>` disclosure: Audit log, Job recovery, Personal MCP,
  env/config notes. Default collapsed.

**Files:**
[`components/integrations/provider-connections.tsx`](../apps/web/src/components/integrations/provider-connections.tsx),
[`components/integrations/connected.tsx`](../apps/web/src/components/integrations/connected.tsx),
[`components/integrations/catalog.tsx`](../apps/web/src/components/integrations/catalog.tsx),
new `app/app/connections/` routes, new `components/connections/connect-wizard.tsx`,
`app/app/team/integrations/page.tsx`. Reuses existing API endpoints; no
new backend.

**Acceptance:** a non-technical user connects Drive/Linear/GitHub
end-to-end without ever seeing `externalId`, `resourceKind`, or "MCP";
admin handoff is inline and human-named; existing tests updated and green.

## Phase U3 — Actionable errors (the "feels broken" fix)

Every error chip gets a fix button; raw error strings become human +
collapsible details.

- Add a next-action CTA beside every error state:
  - "Needs reconnect" chip → **Reconnect** button (re-runs OAuth start)
    ([`provider-connections.tsx:216`](../apps/web/src/components/integrations/provider-connections.tsx)).
  - `lastError` on connected integrations → **Retry sync** / **Reconnect**
    ([`connected.tsx:84`](../apps/web/src/components/integrations/connected.tsx)).
  - "Access revoked" → **Re-share** or **Remove**
    ([`provider-connections.tsx:474`](../apps/web/src/components/integrations/provider-connections.tsx)).
- Replace `dialog.alert({ description: raw res.text() })` with a typed
  error UI: one human sentence + **Try again** + a collapsible **Details**
  for the raw string. Apply in
  [`catalog.tsx:24`](../apps/web/src/components/integrations/catalog.tsx),
  [`connected.tsx:54`](../apps/web/src/components/integrations/connected.tsx),
  `provider-connections.tsx` save/delete paths.
- New `components/error-action.tsx`: maps an error to `{ message, action }`
  so error→action pairing is consistent across surfaces. Reuses
  `components/error-state.tsx` for hard errors.
- Empty states must never tell non-technical users to edit env. Replace
  the integrations empty state
  ([`team/integrations/page.tsx:233`](../apps/web/src/app/app/team/integrations/page.tsx))
  with "GitHub sync isn't enabled yet" + **Ask an admin to enable** (or,
  for admins, a link to the setup doc).
- API error responses keep the raw string available (in `details`), so
  power users and logs lose nothing.

**Acceptance:** no error chip anywhere without a next action; raw strings
only inside collapsible Details; `pnpm validate` + doctor 100; targeted
tests for the connect/sync error paths.

## Phase U4 — Discoverability

Make the hidden structure visible and teach the product's differentiator.

- **Sources hub → Connections overview.** Replace the link-card grid
  ([`app/app/sources/page.tsx`](../apps/web/src/app/app/sources/page.tsx))
  with a per-source status list: **Connected / Needs attention / Not set
  up**, each with a one-click fix (Reconnect, Continue setup, Ask admin).
  Link-cards become the empty/first-run state only.
- **Timeline coachmark.** First-time users get a one-time pointer tying
  the citation chip to the inspector: "Click any `[c:…]` to see the raw
  source — that's the point of this product." Dismissible, stored in
  onboarding state. The citation→evidence relationship is currently
  invisible until you stumble on it.
- **Home first-run hero.** Pull `OnboardingChecklist` above the fold;
  gate the "Quick actions" grid behind accounts with <2 completed steps;
  keep the daily digest and recent moments below. Solo new users should
  see onboarding first, not six destinations.

**Files:**
[`app/app/sources/page.tsx`](../apps/web/src/app/app/sources/page.tsx),
[`components/onboarding-checklist.tsx`](../apps/web/src/components/onboarding-checklist.tsx),
[`app/app/page.tsx`](../apps/web/src/app/app/page.tsx),
[`components/timeline-feed.tsx`](../apps/web/src/components/timeline-feed.tsx)
(coachmark), `app/actions/onboarding.ts` (dismiss state).

**Acceptance:** new users land on onboarding, not a wall of links; the
citation→inspector relationship is taught once; the Sources hub shows
status + fix, not just links.

## Phase U5 — IA consolidation

Collapse 13+ destinations down to 7.

- Merge **Sources** + **Team → integrations / telegram / slack /
  mcp-servers / mcp-share** into one **Connections** area whose hub is the
  U4 overview.
- Move **Audit** and **Job recovery** under an admin-only **Admin** group
  (not top-level nav).
- Fold `me/connections` and `me/mcp-servers` into the U2 wizard; redirect
  the old routes to the wizard's relevant step.
- New top-level nav: **Home, Timeline, Ask, Work, Documents, Connections,
  Team** (7). Update `components/nav-items.ts`,
  `components/desktop-sidebar.tsx`, `components/mobile-nav.tsx`,
  `components/rail-nav.tsx`, and `design.md` iconography table.
- Add redirects for retired routes so bookmarks and `g t`/`g o`/`g b`
  keymap entries still resolve (update
  [`components/keymap.tsx`](../apps/web/src/components/keymap.tsx)).

**Acceptance:** 7 top-level destinations; no jargon labels in nav; old
routes redirect; keymap still works; `pnpm validate` + doctor 100.

## Phase U6 — Polish and verification

- Run `/plan-design-review` on the standard-page direction before
  broad rollout; run `/qa` on the connect wizard.
- Before/after screenshots in the PR body for Home, Sources, Connections,
  Integrations, and one operational page (to prove it's unchanged).
- Tests: `pnpm validate` + `pnpm run doctor` (100). Run
  `pnpm test:dist-imports` only if shared package exports change (not
  expected). Run `pnpm test:eval` only if agent tools / retrieval change
  (not expected). Run the nearest Vitest suite for any touched page
  (`*.test.tsx`).
- Update `README.md` only if the seed credential list changes (not
  expected here).

## Sequencing and dependencies

```
U1 (foundation) ──┬─→ U2 (connect wizard) ──→ U4 (Sources overview) ──→ U6
                  ├─→ U3 (actionable errors) ──────────────────────────→ U6
                  └─→ U5 (IA consolidation) depends on U2 ─────────────→ U6
```

- **U1 first** — everyone needs `PageHeader` + `SectionHeading`.
- **U2 and U3 parallelize** after U1 — different files (connect flow vs
  error UI).
- **U4 after U2** — the Connections overview needs the wizard's status
  model.
- **U5 after U2** — the wizard replaces `me/*` routes.
- **U6 last** — review + verification across everything.

## Out of scope

- Full rebrand / "Simple mode" (Direction B) — not chosen.
- Changing the operational Timeline / Approvals / Jobs visual language.
- Data-model changes; team isolation, secrets, MCP output fencing, SSRF
  guard, and meeting-bot consent gating unchanged.
- New backend endpoints — U2 reuses existing integration/connection APIs.

## Risks

- **`design.md` drift.** Visual changes must update `design.md` in the
  same PR (repo guardrail). U1 does this explicitly; later phases touch
  the doc when they add components.
- **Power-user regression from hiding raw IDs.** Mitigated: raw IDs stay
  in the inspector; operational surfaces keep mono.
- **Wizard admin handoff.** Keep a no-extra-step path for solo-admin teams
  where owner == admin; only show the approval step when the roles differ.
- **Nav changes break muscle memory.** Mitigated: redirects for retired
  routes and updated keymap.
