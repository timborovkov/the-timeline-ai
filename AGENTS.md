# Agent instructions

Conventions for any AI coding agent working in this repo (Claude Code, Codex,
Cursor, etc.).

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
- **Run `pnpm validate` before declaring work complete.** Runs
  `format:check`, `typecheck`, `lint`, and `knip` in sequence — the same
  gates CI enforces. Fix failures at the root cause; do not skip.
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
  web/      Next.js 15 app (App Router, RSC, server actions, Auth.js)
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
            module (Phase 11 — Drive/Linear/GitHub providers, event-writer,
            registry catalog, AES-GCM secrets helper), mcp module (Phase 11
            — JSON-RPC client, OAuth client + state JWT, SSRF guard,
            team+user-overlay scope), mcp-server module (Phase 11 outbound —
            JSON-RPC handler, bearer-key mint/verify for /api/mcp/server),
            calendar module (Phase 11 — event scope, raw-event audit rows,
            entity links, settings, and calendar embedding enqueue/delete),
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
