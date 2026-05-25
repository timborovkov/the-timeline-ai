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
  `withTeam(db, teamId, userId)` in `packages/shared`. Every Qdrant query
  filters on `team_id` via the wrapper. Do not bypass these — even in
  "internal" tools.
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

## Repo layout

```
apps/
  web/      Next.js 15 app (App Router, RSC, server actions, Auth.js)
  worker/   BullMQ workers (transcribe, extract, embed, document-extract,
            meeting-finalize, overdue-scan, janitor)
packages/
  db/       Drizzle schema + migrations
  shared/   Cross-package code: withTeam scope, llm wrapper, Qdrant wrapper,
            S3 wrapper, Telegram dispatcher, queue names, objects module,
            documents module (Phase 9 — folders/documents/versions/chunks
            scope, RustFS object-key builder, text chunker), meeting-bots
            module (Phase 10 — Recall.ai provider, Svix verifier) +
            meetings scope (meeting/chunk/usage helpers)
docs/
  setup/    External service walkthroughs (Telegram, OpenRouter, Postmark,
            Recall.ai meeting bots, Sentry, Railway, local dev)
```

Phased build plan and current state: [todo.md](todo.md). Product vision:
[docs/product-brief.html](docs/product-brief.html). Design system: [design.md](design.md).
