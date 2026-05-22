# Claude Code instructions

Project-specific rules for Claude Code sessions in this repo. For shared
agent conventions (handoff protocol, skill routing, project guardrails) see
[AGENTS.md](AGENTS.md) — read that first.

## Handoff protocol — always run `/document-release` before handing back

**At the end of every meaningful task, before you hand control back to the
user, invoke the `/document-release` skill via the Skill tool.** This is
mandatory, not optional.

Trigger it when any of these are true:

- The user signaled the work is done ("ship it", "land this", "we're done",
  "looks good").
- You're about to invoke `/ship`, open a PR, push to `main`, or call
  `/land-and-deploy`.
- You're ending a session that produced a real diff and the next session may
  not have your context.
- A feature branch is functionally complete and ready for review.

The skill audits every `*.md` in the repo against the working-tree diff,
applies factual corrections automatically (paths, counts, list entries),
flags risky changes for your review, and produces a documentation health
report. See [`/document-release` SKILL.md](~/.claude/skills/document-release/SKILL.md)
for the full workflow.

**Do not declare a task complete without running it.** A redesign that leaves
[design.md](design.md) stale, a new env var missing from
[`docs/setup/*`](docs/setup/), or a finished item still listed as open in
[todo.md](todo.md) are all bugs you can catch by running the skill.

If the diff is empty (read-only exploration, planning-only sessions), the
skill exits cleanly with "All documentation is up to date." Run it anyway —
the cost is one tool call.

## Skill routing

Invoke skills via the Skill tool when the user's request matches one. When in
doubt, invoke the skill.

- Product ideas / brainstorming → `/office-hours`
- Strategy / scope review → `/plan-ceo-review`
- Architecture review → `/plan-eng-review`
- Design system / mockup review → `/design-consultation` or
  `/plan-design-review`
- Full pre-build pipeline → `/autoplan`
- Bugs / errors / "why is this broken" → `/investigate`
- QA / "does this actually work" → `/qa` (full) or `/qa-only` (report only)
- Pre-merge code review → `/review`
- Visual / UI audit on a running site → `/design-review`
- Ship / deploy / open a PR → `/ship`, then `/land-and-deploy`
- Save progress / resume context → `/context-save` and `/context-restore`
- **Handoff / end of task → `/document-release`** (see above)

## Project-specific notes

See [AGENTS.md](AGENTS.md#project-specific-guardrails) for the full list. The
non-negotiables:

- All DB access goes through `withTeam(db, teamId, userId)` —
  [`packages/shared/src/team-scope.ts`](packages/shared/src/team-scope.ts).
- Raw events are append-only. Never mutate `raw_events` content.
- The design system in [design.md](design.md) is the source of truth for UI.
- One inference layer: `llm.chat()`, `llm.embed()`, `llm.transcribe()`.
- `pnpm` only. `pnpm -r build` is the canonical build.

## Repo layout

```
apps/
  web/      Next.js 15 app (App Router, RSC, server actions, Auth.js)
  worker/   BullMQ workers (transcribe, extract, embed)
packages/
  db/       Drizzle schema + migrations
  shared/   Cross-package code: withTeam scope, llm wrapper, Qdrant wrapper,
            S3 wrapper, Telegram dispatcher, queue names
docs/
  setup/    External service walkthroughs (Telegram, OpenRouter, Postmark,
            Sentry, Railway, local dev)
```

Phased build plan and current state: [todo.md](todo.md). Product vision:
[docs/product-brief.html](docs/product-brief.html). Design system: [design.md](design.md).
