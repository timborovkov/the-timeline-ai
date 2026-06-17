# Agent instructions

Conventions for any AI coding agent working in this repo (Claude Code, Codex,
Cursor, etc.).

## Non-negotiable completion gates

These gates are repo-wide, not scoped to the files you touched. Do not hand back,
commit, push, open a PR, mark work complete, or call a task "done" while any gate
is red.

After **any** code, configuration, or documentation change:

1. Run `pnpm validate`.
   - This is the canonical static gate and must pass.
   - It runs Prettier formatting checks, TypeScript compilation/typecheck,
     ESLint, and Knip.
2. Run `pnpm run doctor`.
   - React Doctor must report a 100 score before handoff.
   - If the command exits without showing a score, do not claim "React Doctor is
     100" unless you can verify that from the tool output, artifacts, or
     documented behavior. Say exactly what was verified.
3. Run tests appropriate to the change.
   - For code changes, run the nearest targeted test command for the behavior
     touched.
   - Run `pnpm test:dist-imports` when a change touches shared package exports,
     compiled output, or Node runtime loader boundaries.
   - Run `pnpm test:eval` when a change touches agent tools, retrieval,
     visibility filters, MCP tool handling, or answer synthesis.
   - Run broader suites such as `pnpm test`, `pnpm e2e`, or a package-filtered
     Vitest/e2e command when the blast radius is shared, cross-package,
     user-facing, or hard to localize.
   - For docs-only changes, tests may be skipped only when no executable
     behavior, scripts, examples, or generated artifacts changed.

If any completion gate fails:

- Fix the root cause even when it appears unrelated to your change. Treat
  unrelated compile, lint, formatting, React Doctor, or test failures as repo
  health bugs in the current task.
- Rerun the failed gate after fixing it. If the fix could affect another gate,
  rerun the full checklist.
- Do not downgrade, silence, delete, or loosen checks to get green unless the
  check itself is objectively wrong and the replacement is stricter or equally
  strict.
- Escalate only after a serious root-cause attempt, with the exact failing
  command, error, what you tried, and what blocks completion.

Use `pnpm` only. Do not use `npm` or `yarn`.

## Handoff protocol — run `/document-release` before handing back

**Before you hand control back to the user at the end of a meaningful chunk of
work, run the `/document-release` skill.** Treat this as the last step of the
task, not an optional polish pass.

A "handoff" means any of:

- The user said "ship it", "we're done", "land this", or otherwise indicated
  the work is complete.
- You're about to call `/ship`, open a PR, or merge to `main`.
- You're stopping for the day and the next session (or another agent) will
  pick up.
- A feature branch is functionally complete and ready for review.

`/document-release` audits every `*.md` in the repo against the diff:
[README.md](README.md), [design.md](design.md), [todo.md](todo.md),
[docs/product-brief.html](docs/product-brief.html), [docs/railway.html](docs/railway.html),
and [`docs/setup/*`](docs/setup/). It catches stale facts, broken cross-references,
missing entries in lists/tables, and architecture diagram drift. **Do not skip
it.** A redesign that doesn't update [design.md](design.md), a new env var that
doesn't show up in setup docs, or a finished TODO item that's still in the
"open" section are all bugs.

If a handoff happens without a meaningful diff (you only read code, or did
exploratory work), `/document-release` will exit with "All documentation is up
to date" and that's fine. Run it anyway.

## Skill routing

When the user's request matches an available skill, invoke it via the Skill
tool. When in doubt, invoke the skill.

- New feature / non-trivial change → finish with `/document-release` and
  `/ship`.
- Bugs / unexpected behavior → `/investigate` (root-cause discipline).
- Visual polish or design questions → `/design-review` (or
  `/plan-design-review` in plan mode).
- Pre-merge code review → `/review`.
- QA / "does this actually work?" → `/qa`.
- Save / resume working context → `/context-save` and `/context-restore`.

## Keep this file current

Treat this file as an operating contract for agents, not a loose README.

- When package scripts, validation commands, CI gates, repo layout, or required
  workflows change, update this file in the same PR.
- When product architecture moves across packages or major modules are added,
  removed, or renamed, update the repo layout and guardrails here.
- When instructions here conflict with code, package scripts, or CI, fix the
  stale instruction or the stale implementation before handing back.
- Prefer concise hard rules in `AGENTS.md`; put long product explanation in
  [CONTEXT.md](CONTEXT.md), roadmap state in [todo.md](todo.md), and design
  language in [design.md](design.md).

## Project-specific guardrails

- **Team isolation is sacred.** Every Postgres query goes through
  `withTeam(db, teamId, userId)` in `packages/shared`. Use the returned
  named modules (`scope.timeline`, `scope.documents`, `scope.meetings`,
  `scope.objects`, `scope.calendar`, `scope.integrations`, `scope.mcp`,
  `scope.onboarding`, `scope.jobRecovery`) rather than flat scope methods or manually passing
  `db` into object helpers. Every Qdrant query filters on `team_id` via the
  wrapper. Do not bypass these — even in "internal" tools.
- **Raw events are immutable.** Never `UPDATE` a `raw_events` row's content.
  Derived facts can be re-extracted; the source is the source.
- **Design system lives in [design.md](design.md).** If a screen disagrees with
  it, fix the screen — not the doc. If you're intentionally evolving the design
  language, update [design.md](design.md) in the same PR.
- **One inference layer.** `llm.chat()`, `llm.embed()`, `llm.transcribe()`,
  `llm.extractTextFromMedia()` (Phase 9 vision OCR) in `packages/shared`.
  No direct OpenAI / OpenRouter SDK calls from app or worker code.
- **`pnpm` only** (no `npm` / `yarn`). Workspace packages are wired via
  Turborepo; `pnpm -r build` is the canonical build.
- **Use the dev seed for local demo data.** `pnpm dev:seed` creates the
  documented Acme Labs team, fake login users, events, objects, board, and
  encrypted fake integration credentials after migrations. Keep the credential
  list in [README.md](README.md) current when the seed changes.
- **Use the repo's canonical import paths.** In `apps/web/src`, use the `@/`
  alias for source imports and exports instead of relative paths (`../`,
  `./foo`). The only expected relative side-effect import there is local CSS,
  such as `./globals.css`. In `apps/worker/src`, `packages/shared/src`, and
  `packages/db/src`, use the package-local Node `imports` alias (`#src/...`) for
  internal source imports/exports. Across package boundaries, use the workspace
  package names (`@timeline/db`, `@timeline/shared`, and exported subpaths)
  rather than deep relative paths; root scripts should also consume exported
  `@timeline/*` subpaths instead of reaching into `packages/*/src`.
- **Meeting bots are silent + consent-gated.** Phase 10 ships transcript
  capture only — no voice/agent mode. `team_meeting_settings
  .require_host_consent` (default true) blocks scheduling unless the
  caller has explicitly confirmed participants will be informed. Raw
  audio is NOT copied to S3; transcript text is the only persistent
  record.
- **All integration secrets at rest go through `crypto/secrets.ts`.**
  AES-256-GCM, key from `SECRETS_ENCRYPTION_KEY`. Never store an OAuth
  refresh token or bearer config as plaintext; the column triplet is
  `*_ciphertext`/`*_iv`/`*_tag`. Same applies to inbound MCP
  (`mcp_oauth_tokens`, `mcp_servers.auth_config_*`) and any future
  third-party token storage.
- **MCP tool outputs are untrusted.** Every output from a connected
  custom MCP server flows through `fenceExternalContent` in
  [`packages/shared/src/agent/tools.ts`](packages/shared/src/agent/tools.ts)
  before the agent sees it (Rule 8 of the system prompt). Same for
  integration event snippets surfaced via `search_integration_events`.
  A new tool that surfaces external content MUST wrap it.
- **Outbound MCP bearer keys see only `team`-visibility events.** The
  `/api/mcp/server` handler uses `withTeam(db, teamId, ZERO_UUID,
  { skipMembershipCheck: true })`. The zero-UUID can't match
  `authorUserId` (private) or `visibilityUserIds` (specific_users), so
  those events stay invisible. Do not loosen this — bearer keys
  represent a team, not a user.
- **No SSRF from user-supplied or discovered URLs.** `validateMcpUrl`
  in [`packages/shared/src/mcp/auth.ts`](packages/shared/src/mcp/auth.ts)
  rejects loopback, RFC1918, RFC 3927 link-local (169.254/16 — cloud
  metadata!), IPv6 link-local / unique-local, `.local`, `.internal`,
  and `http://` in production. Any new outbound fetch against a URL
  that originated outside our code must go through this guard.

## Repo layout

```
apps/
  web/      Next.js 16 app (App Router, RSC, server actions, Auth.js)
  worker/   BullMQ workers (transcribe, extract, embed, document-extract,
            meeting-finalize, overdue-scan, janitor, integration-sync,
            mcp-health)
packages/
  db/       Drizzle schema + migrations
  shared/   Cross-package code: withTeam workspace port, llm wrapper, Qdrant
            wrapper, S3 wrapper, Telegram dispatcher, queue names, shared
            embedding source planner, objects module,
            documents module (Phase 9 — folders/documents/versions/chunks
            scope, RustFS object-key builder, text chunker), meeting-bots
            module (Phase 10 — Recall.ai provider, Svix verifier) +
            meetings scope (meeting/chunk/usage helpers), integrations
            module (Phase 11 — Drive/Linear/GitHub providers, person-owned
            provider connections, team resource shares, active source paths,
            connection attention, event-writer, registry catalog, AES-GCM
            secrets helper), mcp module (Phase 11
            — JSON-RPC client, OAuth client + state JWT, SSRF guard,
            team+user-overlay scope), mcp-server module (Phase 11 outbound —
            JSON-RPC handler, bearer-key mint/verify for /api/mcp/server),
            calendar module (Phase 11 — event scope, raw-event audit rows,
            entity links, settings, team calendar subscriptions, and calendar
            embedding enqueue/delete),
            conversation-review module (bounded Slack/Telegram evidence
            windows for proposal generation),
            onboarding module (Phase 13 — team-level tutorial completion +
            per-user dismissal), job-recovery module (Phase 13 — team-scoped
            retry/dismiss for failed product jobs), slack module (Phase 12 —
            OAuth install/user link, signed events/commands, conversation
            bindings, capture)
docs/
  setup/    External service walkthroughs (Telegram, OpenRouter, Postmark,
            Slack, Recall.ai meeting bots, Sentry, Railway, local dev,
            third-party integrations + Timeline-as-MCP-server)
```

Phased build plan and current state: [todo.md](todo.md). Product vision:
[docs/product-brief.html](docs/product-brief.html). Design system: [design.md](design.md).
