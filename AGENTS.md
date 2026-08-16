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
   - The root script runs `scripts/run-react-doctor.mjs`, which executes the
     real React Doctor analyzer in JSON mode and posts diagnostics to the
     non-redirecting score endpoint. Treat `React Doctor score: 100` plus
     `No issues found!` as the required pass signal.
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
   - Run `pnpm test:proposal-engine:live` with
     `PROPOSAL_ENGINE_LIVE_ENV_FILE=/path/to/.env` when proposal-engine
     qualify/attach, container-label hubs, or messy live fixtures change **and**
     a real `OPENROUTER_API_KEY` (and Qdrant, for the vector cases) is
     available. This is an opt-in live eval, not CI.
   - Run `pnpm test:task-category-eval:live` with
     `TASK_CATEGORY_LIVE_ENV_FILE=/path/to/.env` when the task-category
     taxonomy, classifier packet, prompt, schema, or pinned model changes.
   - Run `pnpm test:reconciliation-eval` when a change touches reconciliation
     schema, source refs, evidence associations, visibility floors, authority
     policy, or reconciliation output planning. Run
     `pnpm test:reconciliation-eval:live` when prompts or live-model
     reconciliation behavior changed and the required env vars are available.
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
[docs/relational-memory.md](docs/relational-memory.md),
and [`docs/setup/*`](docs/setup/). It catches stale facts, broken cross-references,
missing entries in lists/tables, and architecture diagram drift. **Do not skip
it.** A redesign that doesn't update [design.md](design.md), a new env var that
doesn't show up in setup docs, a signal-class ingest change that doesn't match
[docs/relational-memory.md](docs/relational-memory.md), or a finished TODO item
that's still in the "open" section are all bugs.

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
  [CONTEXT.md](CONTEXT.md), the operating memory engine in
  [docs/relational-memory.md](docs/relational-memory.md), roadmap state in
  [todo.md](todo.md), and design language in [design.md](design.md).

## Project-specific guardrails

- **Team isolation is sacred.** Every Postgres query goes through
  `withTeam(db, teamId, userId)` in `packages/shared`. Use the returned
  named modules (`scope.timeline`, `scope.documents`, `scope.meetings`,
  `scope.objects`, `scope.boards`, `scope.pins`, `scope.suggestions`, `scope.calendar`,
  `scope.integrations`, `scope.mcp`, `scope.onboarding`, `scope.jobRecovery`,
  `scope.reconciliation`, `scope.audit`, `scope.conversations`) rather than flat scope methods or
  manually passing `db` into object helpers. Every Qdrant query filters on
  `team_id` via the wrapper. Do not bypass these — even in "internal" tools.
- **Captured raw event content is immutable.** Never `UPDATE` a source-ingested
  `raw_events` row's content. Derived facts can be re-extracted; the source is
  the source. Calendar raw-event rows are derived schedule mirrors and may
  refresh their timeline text, occurrence time, and visibility when the owning
  calendar event changes.
- **Proposal writes qualify hubs; they do not cosine-write.** Communication
  proposals attach existing company/project objects only on unique name
  mention or container label (Slack channel, Monday board, meeting title,
  Telegram chat title, repo/team name). See
  [docs/relational-memory.md](docs/relational-memory.md) Layer 6 and
  [ADR 0015](docs/adr/0015-proposal-writes-qualify-hubs-from-mentions-and-container-labels.md).
  Recency dumps and embeddings recall. Captured-work parsers join on provider
  id, alias, or unique `repo#n`. Envelope `signalClass` decides extract vs
  parse vs pulse; see
  [ADR 0016](docs/adr/0016-ingest-signal-class-lives-on-the-envelope.md).
  Do not substitute timeline `event_class` (`communication` / `work_record` /
  `pulse` / `incident` / `artifact` / `schedule`) for envelope `signalClass`.
  Writers stamp both; ingest and proposals read `signalClass`.
  Do not add an ingest summarizer whose only job is prettier embeddings.
- **Design system lives in [design.md](design.md).** If a screen disagrees with
  it, fix the screen — not the doc. If you're intentionally evolving the design
  language, update [design.md](design.md) in the same PR.
- **One inference layer.** `llm.chatStructured()`, `llm.streamChat()`, `llm.embed()`,
  `llm.embedMany()`, `llm.transcribeAudio()`, `llm.extractTextFromMedia()` (Phase 9 vision OCR) in `packages/shared`.
  No direct OpenAI / OpenRouter SDK calls from app or worker code.
- **`pnpm` only** (no `npm` / `yarn`). Workspace packages are wired via
  Turborepo; `pnpm -r build` is the canonical build.
- **Use the verified demo seed for recorded demos and local regression checks.** `pnpm demo:seed`
  runs the idempotent `pnpm dev:seed`, indexes every deterministic fixture source through the real
  embed worker/OpenRouter/Qdrant path, and then runs `pnpm demo:verify`. It creates the
  documented Acme Labs team, eight fake login users, a month of timeline events, objects, custom
  boards, documents, meetings, Ask history, pending proposals, digest history, and the
  deterministic fictional Northstar evidence corpus with encrypted fake integration credentials after
  migrations. `pnpm demo:reset` is `pnpm dev:wipe && pnpm demo:seed`. `pnpm demo:verify` fails closed on all eight login identities, active memberships,
  password usability, downloaded document-byte checksums, scoped Qdrant
  discoverability for Northstar raw events/facts/document chunks/meeting chunks, expanded-corpus
  document `embedded` status and chunk vectors, fixture chronology,
  visibility, source links, canonical support drift, or expanded-corpus volume floors. The commands refuse production and
  unapproved remote databases/Qdrant; S3 writes additionally require the local endpoint and
  `timeline-documents` bucket unless `ALLOW_DEV_SEED_STORAGE` carries the documented explicit
  isolated-storage acknowledgement. `pnpm dev:seed:heavy` adds extra Acme Labs rows after that
  corpus so infinite-scroll fetches and virtualization have enough volume. The fake
  integrations stay disabled for sync so local workers do not call real
  providers. Live daily-digest send stays off; historical digest rows are still seeded.
  Keep the credential list in [README.md](README.md) and the glossary in
  [docs/demo-corpus.md](docs/demo-corpus.md) current when
  the seed changes.
- **Monday helper-board repair is dry-run first.** Use `pnpm repair:monday --
  --env-file=/path/to/.env --team-id=<uuid> --user-id=<uuid>` to inspect stale
  classic helper-board state. Add `--apply` only after reviewing the team-scoped
  identifier/count report; the command must never delete captured raw events.
  Apply-mode backfill and webhook follow-ups are durable: rerun the same apply
  command to resume any failed step without repeating one already completed.
- **Daytona snapshot cleanup requires deployed-hash protection.** Run
  `pnpm --filter @timeline/worker cleanup-document-extract-snapshots -- --retain=3`
  only with `DAYTONA_ACTIVE_SNAPSHOTS` listing every snapshot used by a deployed
  production or staging extractor. Cleanup retains those deployed hashes plus
  the current and two rollback hashes, skips sandbox-referenced snapshots, and
  must fail closed when the deployed inventory is missing or stale. Push CI may
  ensure snapshots, but must not delete them without that external deployment
  inventory.
- **Use the repo's canonical import paths.** In `apps/web/src`, use the `@/`
  alias for source imports and exports instead of relative paths (`../`,
  `./foo`). The only expected relative side-effect import there is local CSS,
  such as `./globals.css`. Client digest UI imports `@timeline/shared/messaging/format`
  rather than the Node messaging barrel. In `apps/worker/src`, `packages/shared/src`, and
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
  [`packages/shared/src/agent/external-content.ts`](packages/shared/src/agent/external-content.ts)
  before the agent sees it (Rule 8 of the system prompt). Same for
  integration event snippets surfaced via `search_integration_events`.
  A new tool that surfaces external content MUST wrap it.
  Successful team-shared MCP calls are captured as immutable team-visible
  evidence; personal-server calls remain private to their owner. Capture
  dedupe keys include server scope/owner and must never broaden an older
  private event.
- **Agent presentation follows the current delivery surface.** Literal web
  delivery uses the rich cited profile. Telegram, Slack, and every future
  external chat provider use the shared compact plain-text profile; internal
  Timeline citation syntax and raw-event IDs are removed before persistence
  and the formatter is reapplied idempotently before cached delivery. New
  provider adapters must reuse this policy rather than adding provider-specific
  answer prompts or citation sanitizers. The external output-token ceiling is
  applied only in a no-tool final-answer pass; retrieval, visibility, grounding,
  and tool-call budgets remain unchanged.
  Outbound `timeline.ask_agent` uses the separate compact `mcp_agent` profile,
  which preserves inline Timeline citations and returns parsed artifact refs.
- **Outbound MCP bearer keys see only `team`-visibility events.** The
  `/api/mcp/server` handler uses `withTeam(db, teamId, ZERO_UUID,
  { skipMembershipCheck: true })`. The zero-UUID can't match
  `authorUserId` (private) or `visibilityUserIds` (specific_users), so
  those events stay invisible. Do not loosen this — bearer keys
  represent a team, not a user.
- **Synthetic team agents are proposal-only.** Agent-enabled outbound MCP keys
  and unlinked trusted Telegram groups/Slack channels may read team-visible
  data, call team-shared custom MCP tools, and create new team-visible
  proposals. They may not revise proposals, use personal pins, invoke
  approval-required `execute_*` tools, or mutate canonical state. Existing MCP
  keys remain read-only unless an admin explicitly grants `agent:ask`.
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
  worker/   BullMQ workers (conversation-agent, transcribe, extract,
            suggestions, embed,
            overdue-scan, calendar-recurrence,
            meeting-finalize, meeting-scheduler, object-summary, janitor,
            task-category,
            webhook-delivery, integration-sync, mcp-health, team-export,
            daily-digest, timeline-moment-presentation, reconciliation);
            also hosts the credential-thin document-extract orchestrator service
            (`WORKER_MODE=document-extract` / `extract-main`, Daytona
            sandboxes — ADR 0013)
packages/
  db/       Drizzle schema + migrations
  shared/   Cross-package code: withTeam workspace port, llm wrapper, Qdrant
            wrapper, S3 wrapper, Telegram dispatcher, queue names, shared
            embedding source planner, objects module, personal pins module
            (ordered cross-type pins with visibility-safe target adapters),
            documents module (Phase 9 — folders/documents/versions/chunks
            scope, RustFS object-key builder, text chunker), meeting-bots
            module (Phase 10 — Recall.ai provider, Svix verifier) +
            meetings scope (meeting/chunk/usage helpers), integrations
            module (Phase 11 — Drive/Linear/GitHub/Monday.com/Slack/Sentry
            providers, person-owned provider connections, team resource
            shares, active source paths, connection attention, event-writer,
            registry catalog, AES-GCM secrets helper), event-class taxonomy
            (provider-agnostic communication / work_record / pulse / incident /
            artifact / schedule; ingest webhooks set class in settings),
            artifact/workspace
            reconciliation modules (evidence clusters, anchors, source refs,
            raw-event normalization, anchor resolution, reconciliation outputs,
            approval projection outbox, and field-scoped authority policy),
            evidence-pack module (policy-bound, visibility-safe raw-event packs
            for proposal citations and Agent Ask retrieval),
            mcp module (Phase 11 — JSON-RPC client, OAuth client + state JWT, SSRF guard,
            team+user-overlay scope), mcp-server module (Phase 11 outbound —
            JSON-RPC handler, bearer-key mint/verify for /api/mcp/server),
            calendar module (Phase 11 — event scope, raw-event audit rows,
            entity links, settings, team calendar subscriptions, and calendar
            embedding enqueue/delete),
            conversation-review module (bounded Slack/Telegram evidence
            windows for proposal generation),
            conversation-surfaces module (provider-neutral direct-chat
            sessions, durable turn ledger, bounded history, Telegram/Slack
            delivery adapters, shared web-rich/external-chat agent presentation,
            and conversation-agent queue),
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

## Cursor Cloud specific instructions

### Local stack for this environment

- Infra (Postgres, Redis, Qdrant, RustFS) is started with `docker compose up -d` from the repo root. Dockerd is not managed by systemd here — if containers are down, ensure `dockerd` is running first, then compose up. Confirm health with `docker compose ps`.
- App processes: web (`apps/web`, Next.js on `:3000`) + worker (`apps/worker`, BullMQ). Standard commands are in [README.md](README.md) (`pnpm dev`, `pnpm db:migrate`, `pnpm demo:seed`, `pnpm demo:verify`, `pnpm demo:reset`, `pnpm validate`, `pnpm test`, `pnpm run doctor`).
- Seeded demo logins (after `pnpm db:migrate` + `pnpm demo:seed`): `owner@timeline.dev`, `member@timeline.dev`, `jordan@timeline.dev`, `sam@timeline.dev`, `riley@timeline.dev`, `casey@timeline.dev`, `quinn@timeline.dev`, `harper@timeline.dev`, password `timeline-dev`. Full glossary: [docs/demo-corpus.md](docs/demo-corpus.md).

### Non-obvious env / startup gotchas

- **Node must be >=24.** This Cloud Agent image ships an older Node on `/exec-daemon` ahead of nvm on `PATH`. Prefer the nvm Node 24 binary (see `~/.bashrc` PATH override). Use `pnpm` via Corepack on that Node (`packageManager` pins `pnpm@11.8.0`).
- **Root `.env` is not auto-loaded by the worker or by `drizzle-kit`.** Next.js loads `apps/web/.env` (symlink to `../../.env`). Before `pnpm db:migrate`, `pnpm demo:seed`, or running the worker, export the root env into the shell, e.g. `set -a; . ./.env; set +a`. Quote any values that contain spaces (for example `RECALL_BOT_DISPLAY_NAME="Timeline Bot"`) or bash will try to execute the trailing words when sourcing.
- **The root `pnpm dev` script must keep `--env-mode=loose`.** Turbo's strict default strips unlisted env vars from the worker task even after sourcing `.env`. Alternatively run packages separately with env already exported: `pnpm --filter @timeline/web dev` and `pnpm --filter @timeline/worker dev`.
- Optional URL keys left blank in `.env.example` must use `emptyStringAsUnset` in the shared env schema so the documented shell export flow remains valid.
- Keep a real `OPENROUTER_API_KEY` and `SECRETS_ENCRYPTION_KEY` in `.env` for chat/extraction/embeddings and for `pnpm demo:seed` (seed encrypts fake integration credentials).
