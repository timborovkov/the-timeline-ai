# Agent instructions

Conventions for any AI coding agent working in this repo (Claude Code, Codex,
Cursor, etc.). This file is the source of truth for validation and merge policy.
Other guides should link here rather than maintain competing checklists.
Explicit user instructions about checks take precedence.

## Validation policy

Scope verification to the behavior and risk of the change. GitHub Actions owns
repo-wide validation; do not routinely duplicate it locally.

- **Application code, executable scripts, or generated behavior:** run the nearest
  targeted local tests for the behavior changed. Broaden only when the affected
  boundary or a failure justifies it. Use the change-specific checks below.
- **CI-only changes that do not alter application code or test behavior:** inspect
  workflow syntax, triggers, conditions, and required-check names, then verify the
  affected GitHub run. Do not run local application suites, repo-wide validation,
  or React Doctor merely because workflow YAML is executable configuration.
- **Prose-only docs and agent instructions:** review the diff, changed-file
  formatting, links, and consistency. No application tests or repo-wide checks.
  Executable examples or generated behavior need only the relevant scoped checks.
- **Environment variables, secrets, backup cleanup, and deployment-only work:**
  verify affected settings without exposing secrets, review the relevant diff,
  and verify deployment status when deploying. No unrelated application checks.
- Run repo-wide local validation or full suites only when explicitly requested,
  or when a concrete investigation requires them; state the reason first. Prefer
  GitHub for broad verification. Do not launch a full suite solely because a
  change is cross-package or user-facing.

### GitHub checks and merge gates

- Commits, pushes, and opening PRs are allowed before CI passes; that is how CI
  runs. Required GitHub checks gate **merging**, not opening a PR.
- Do not merge while required checks are pending or failing, bypass protections,
  or weaken checks to obtain a pass. A demonstrably incorrect check may be fixed
  with equally strict or stricter coverage.
- Report targeted checks and GitHub status accurately. A prepared change or open
  PR is not a verified merge or release; pending checks must be called out.
- Fix failures caused by the change, then rerun the affected checks. Report
  unrelated failures separately with evidence; do not automatically expand the
  task into repository-wide repairs. Required failures still block merging.
- GitHub's static gate runs `bun run validate` (Prettier, TypeScript, ESLint,
  Knip) and `bun run doctor`. React Doctor must show
  `React Doctor score: 100` and `No issues found!`; an exit without a score
  is not proof of 100. Diagnose failures locally only as needed.

## Branch and release CI

- `main` is the development branch. PRs require `Static checks`: validation,
  React Doctor, runtime smoke tests, E2E environment contracts, and dist imports.
- `production` is the release branch. PRs require both `Static checks` and
  `Full test suite` (offline unit/integration tests and reconciliation evals),
  with an up-to-date branch and resolved review threads. Direct pushes,
  force pushes, and deletion are blocked; release through a PR from `main`.
- Full tests also run on production pushes and manual CI dispatches. Superseded
  PR runs are cancelled. Browser E2E remains a separate manual workflow.
- Railway must follow `production` after the operator switches its source branch.
  Creating this branch does not change Railway configuration.

## Change-specific verification

These checks apply when the named behavior changes, not to unrelated docs or CI
routing edits. Use targeted local runs while iterating; broader checks can run on
GitHub when available. Live evaluations still require their documented environment
and evidence; never treat an offline CI pass as live promotion evidence.

- Run `bun run test:dist-imports` when a change touches shared package exports,
  compiled output, or Bun runtime loader boundaries.
- Run `bun run test:eval` when a change touches agent tools, retrieval,
  visibility filters, MCP tool handling, or answer synthesis.
- Run `bun run test:proposal-engine:live` with
  `PROPOSAL_ENGINE_LIVE_ENV_FILE=/path/to/.env` when proposal-engine
  qualify/attach, container-label hubs, or messy live fixtures change **and**
  a real `OPENROUTER_API_KEY` (and Qdrant, for the vector cases) is
  available. This is an opt-in live eval, not CI.
- Run `bun run test:task-category-eval:live` with
  `TASK_CATEGORY_LIVE_ENV_FILE=/path/to/.env` when the task-category
  taxonomy, classifier packet, prompt, schema, or pinned model changes.
- Run `bun run eval:transcription-quality:live -- --manifest=/path/to/manifest.json
  --out=/path/to/new-evidence.json --candidate=<model-id>` before changing the
  non-meeting transcription pin. The approved corpus must contain no customer
  data and satisfy the 24-language quality gate documented in
  [docs/research/transcription-quality-eval.md](docs/research/transcription-quality-eval.md).
  A live registry entry or single-language smoke test is not promotion evidence.
- Run `bun run test:reconciliation-eval` when a change touches reconciliation
  schema, source refs, evidence associations, visibility floors, authority
  policy, or reconciliation output planning. Run
  `bun run test:reconciliation-eval:live` when prompts or live-model
  reconciliation behavior changed and the required env vars are available.

Use `bun` only. Do not use `pnpm`, `npm`, or `yarn`.

Offline test execution is declared in `scripts/testing/manifest.json`: each file
gets a fresh process by default; `isolation: "registration"` or `"batch"` (with
`batchSize`) explicitly partitions supported Bun test registrations. The runner
parses test syntax and rejects unsupported isolated titles; source formatting or
`vi.resetModules()` text must never choose execution policy. Preserve test rows
when changing this manifest.

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

Project skills are committed as complete folders in [`.agents/skills`](.agents/skills/README.md),
so cloud checkouts do not depend on a developer's global skills or Mac symlinks.
Use the client's skill invocation mechanism when available; otherwise read the
matching `SKILL.md` and its relevant references directly. Repository instructions
and existing authorization take precedence over generic skill examples. If a skill
requests unavailable delegation tools, perform its relevant review passes serially
and report the limitation.

- Code completion → `document-release`; use `ship` when shipping is requested.
- Branch/PR review → `diff-review`; meaningful test design → `test-strategy`.
- Bugs / unexpected behavior → `diagnosing-bugs`.
- React diagnostics → `react-doctor`, using root `bun run doctor`.
- UI change review → `interface-review`; broader UI audit → `better-interface`
  and its six bundled domain skills. Follow `design.md`.
- QA → the existing targeted tests and Playwright/E2E commands required above;
  do not assume a `/qa` command or a connected browser exists.
- Save context → explicitly invoke `handoff`. Resume by reading the saved handoff
  and checking its claims against the current worktree; no `/context-restore`
  command is required.
- Structural refactoring → explicitly request `untangle-codebase`; scoped
  cleanup → `deslop`; upstream integration → `upstream-sync`.
- Library documentation → bundled Next.js docs first for web work, then
  `find-docs` when external documentation is needed and network access permits.
- Railway operations → `use-railway` only for requested infrastructure work.
  A shipping/PR request does not authorize deployment or account creation.

`ship`, `handoff`, and `interface-review` retain explicit-only invocation policy.
Cloud agents without authenticated Git/PR or Railway tools must report the patch
and remaining execution steps rather than claiming a push or deployment occurred.

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

- **Privacy and trust changes follow the operating standard.** Before changing
  an AI model or route, provider, outbound data flow, telemetry, cookie, storage,
  permission, human-access path, retention/deletion behavior, or public
  security/legal claim, read and apply
  [docs/security-privacy-trust.md](docs/security-privacy-trust.md). Keep provider
  evidence and open gaps current; a public claim may be no stronger than the
  weakest evidenced code, deployment, account, or contract state.
- **Team isolation is sacred.** Every Postgres query goes through
  `withTeam(db, teamId, userId)` in `packages/shared`. Use the returned
  named modules (`scope.timeline`, `scope.documents`, `scope.meetings`,
  `scope.objects`, `scope.boards`, `scope.pins`, `scope.suggestions`, `scope.calendar`,
  `scope.integrations`, `scope.telegram`, `scope.mcp`, `scope.mcpOAuth`, `scope.agentReporting`, `scope.onboarding`, `scope.jobRecovery`,
  `scope.reconciliation`, `scope.audit`, `scope.conversations`, `scope.billing`,
  `scope.billingOperator`) rather than flat scope methods or
  manually passing `db` into object helpers. Every Qdrant query filters on
  `team_id` via the wrapper. Do not bypass these — even in "internal" tools.
  Timeline read queries live in `packages/shared/src/timeline/read-scope.ts`,
  composed behind `withTeam`; presentation cache persistence lives in
  `timeline-moments/presentation-cache.ts`. Suggestion acceptance transaction
  context and after-commit execution belong to `suggestions/acceptance-transaction.ts`.
- **Production Qdrant storage copies require maintenance safeguards.** Follow
  [the production copy runbook](docs/setup/openrouter.html#qdrant-production-copy):
  stop every vector writer, require the operator-only production acknowledgement,
  complete a source snapshot, and verify all teams plus total point coverage before
  switching collections. Retain the original collection and backup for rollback.
- **Account provisioning is a separate pre-team boundary.** `packages/shared/src/agent-provisioning` owns verified-owner grants, idempotency receipts, owner-wide quotas and shared UI/API workspace creation. Only new workspaces may be provisioned; existing-team content still requires `withTeam`. Auth continuations are account-bound global identity records.
- **Platform administration is a separate privilege boundary.** Global account/team directory, support-session, and platform-audit access goes through the verified `platform-admin` service. Impersonated content access still uses `withTeam` and the selected member’s role and visibility. Never replace the real login with the impersonated identity or omit its attribution from jobs.
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
- **`bun` only** (no `pnpm` / `npm` / `yarn`). Workspace packages are wired via
  Turborepo; `bun run build` is the canonical build.
- **Use the verified demo seed for recorded demos and local regression checks.** `bun run demo:seed`
  runs the idempotent `bun run dev:seed`, indexes every deterministic fixture source through the real
  embed worker/OpenRouter/Qdrant path, and then runs `bun run demo:verify`. It creates the
  documented Acme Labs team, eight fake login users,   a month of timeline events whose timestamps are
  relative offsets resolved at first seed time and persisted as `demo_seed_now` so reruns and `demo:verify` reuse that clock, objects, custom
  boards, documents, meetings, Ask history, pending proposals, digest history, the
  deterministic fictional Northstar evidence corpus with encrypted fake integration credentials, and a
  second empty team (`onboarding@timeline.dev` / Noah Blake's Team) for first-run onboarding screens after
  migrations. `bun run demo:reset` is `bun run dev:wipe && bun run demo:seed`. `bun run demo:verify` fails closed on all eight Acme Labs login identities plus the empty-team login, active memberships,
  password usability, current legal-version snapshots with matching immutable acceptance evidence,
  downloaded document-byte checksums, scoped Qdrant
  discoverability for Northstar raw events/facts/document chunks/meeting chunks, expanded-corpus
  document `embedded` status and chunk vectors, fixture chronology,
  visibility, source links, canonical support drift, or expanded-corpus volume floors. The commands refuse production and
  unapproved remote databases/Qdrant; S3 writes additionally require the local endpoint and
  `timeline-documents` bucket unless `ALLOW_DEV_SEED_STORAGE` carries the documented explicit
  isolated-storage acknowledgement. `bun run dev:seed:heavy` adds extra Acme Labs rows after that
  corpus so infinite-scroll fetches and virtualization have enough volume. The fake
  integrations stay disabled for sync so local workers do not call real
  providers. Live daily-digest send stays off; historical digest rows are still seeded.
  Keep the credential list and glossary in
  [docs/demo-corpus.md](docs/demo-corpus.md) current when
  the seed changes.
- **Monday helper-board repair is dry-run first.** Use `bun run repair:monday --
  --env-file=/path/to/.env --team-id=<uuid> --user-id=<uuid>` to inspect stale
  classic helper-board state. Add `--apply` only after reviewing the team-scoped
  identifier/count report; the command must never delete captured raw events.
  Apply-mode backfill and webhook follow-ups are durable: rerun the same apply
  command to resume any failed step without repeating one already completed.
- **Daytona snapshot cleanup requires deployed-hash protection.** Run
  `bun run --filter @timeline/worker cleanup-document-extract-snapshots -- --retain=3`
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
  rather than the Node messaging barrel. Client integration health copy imports
  `@timeline/shared/integrations/health` rather than the Node integrations barrel. In `apps/worker/src`, `packages/shared/src`, and
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
  Outbound `timeline.ask` uses the separate compact `mcp_agent` profile,
  which preserves inline Timeline citations and returns parsed artifact refs.
- **Outbound MCP auth preserves its actor boundary.** Static `tla_`
  bearer keys use `withTeam(db, teamId, ZERO_UUID,
  { skipMembershipCheck: true })`. The zero-UUID can't match
  `authorUserId` (private) or `visibilityUserIds` (specific_users), so
  those events stay invisible; static keys represent a team, not a user.
  OAuth grants instead resolve the consenting member and use normal membership
  checks, so they may read private or specifically shared data that member can
  access in the selected team. Capture is a separate consent/key checkbox, on by
  default, and is required for hosted `timeline.remember`. Only an owner/admin may
  grant OAuth `agent:ask`, and token resolution invalidates that scope after
  demotion. Never collapse these principals or role rules.
- **Outbound MCP OAuth has one pre-principal seam.**
  [`oauth-pre-principal.ts`](packages/shared/src/mcp-server/oauth-pre-principal.ts)
  alone owns the global public-client registry, opaque authorization-code/access-token/
  refresh-token/static-key hash lookup needed to discover a principal, and RFC 7009
  token-possession revocation. Once a lookup yields `teamId` and `userId`, consent,
  grant authorization, exchange/refresh mutations, token use, signed-in listing, and
  signed-in revocation go through `withTeam(...).mcpOAuth`. Keep workspace data outside
  the pre-principal seam.
- **Synthetic team agents are proposal-only.** Agent-enabled outbound MCP
  credentials and unlinked trusted Telegram groups/Slack channels may read team-visible
  data, call team-shared custom MCP tools, and create new team-visible
  proposals. They may not revise proposals, use personal pins, invoke
  approval-required `execute_*` tools, or mutate canonical Timeline state.
  Enabled third-party tools may still cause external side effects. Existing static MCP
  keys remain retrieval-only for canonical state unless an admin explicitly grants `agent:ask`;
  OAuth grants require a current owner/admin for that scope. Hosted MCP
  `timeline.remember` requires the `capture` scope, stores cited ingest evidence through
  `withTeam`, meters accepted sources like other ingest, and never mutates
  canonical records.
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
  worker/   BullMQ workers (email-inbound, conversation-agent, transcribe, extract,
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
            official MCP SDK v2 Streamable HTTP server,
            pre-principal auth discovery, team-scoped OAuth consent/token grants,
            and bearer-key mint/verify
            for /api/mcp/server),
            calendar module (Phase 11 — event scope, raw-event audit rows,
            entity links, settings, team calendar subscriptions, and calendar
            embedding enqueue/delete),
            billing module (Polar MoR, native usage meters, shadow ledger,
            plan catalog, team billing scope),
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
.agents/
  plugins/  Codex marketplace catalog for repository plugins
.claude-plugin/
  marketplace.json  Claude Code repository marketplace catalog
plugins/
  timeline/ Codex + Claude Code plugin manifests, hosted MCP connection,
            and general cited-workspace skill
docs/
  setup/    External service walkthroughs (Telegram, OpenRouter, Resend,
            Slack, Recall.ai meeting bots, Sentry, Railway, local dev,
            third-party integrations + Timeline-as-MCP-server)
```

Phased build plan and current state: [todo.md](todo.md). Product vision:
[docs/product-brief.html](docs/product-brief.html). Design system: [design.md](design.md).

## Cursor Cloud specific instructions

### Local stack for this environment

- Local Compose uses PostgreSQL 18. Existing PostgreSQL 16 volumes must follow [the dump/restore runbook](docs/setup/postgres18.md). Keep `POSTGRES_DATA_VOLUME=postgres_data` until migration; use `postgres18_data` only for the verified destination. Never delete a database volume to fix a major-version startup error.

- Infra (Postgres, Redis, Qdrant, RustFS) is started with `docker compose up -d` from the repo root. Dockerd is not managed by systemd here — if containers are down, ensure `dockerd` is running first, then compose up. Confirm health with `docker compose ps`.
- App processes: web (`apps/web`, Next.js on `:3000`) + worker (`apps/worker`, BullMQ). Standard commands are in [the local setup guide](docs/setup/local.html) (`bun run dev`, `bun run db:migrate`, `bun run demo:seed`, `bun run demo:verify`, `bun run demo:reset`, `bun run validate`, `bun run test`, `bun run doctor`).
- Seeded demo logins (after `bun run db:migrate` + `bun run demo:seed`): Acme Labs `owner@timeline.dev`, `member@timeline.dev`, `jordan@timeline.dev`, `sam@timeline.dev`, `riley@timeline.dev`, `casey@timeline.dev`, `quinn@timeline.dev`, `harper@timeline.dev`; empty onboarding team `onboarding@timeline.dev`. Password for every login is `timeline-dev`. Full glossary: [docs/demo-corpus.md](docs/demo-corpus.md).

### Non-obvious env / startup gotchas

- **Use Bun 1.4.4 from `.bun-version`.** Keep `engines.bun`, `packageManager`, CI, and every Docker stage aligned with that pin. Run `bun --version` before checks. Application execution and tests must not fall back to Node; record any required build/analysis exception in the local validation evidence, not the public README.
- **The repository disables Bun’s automatic `.env` loading with the root and `apps/web/bunfig.toml` files (`env = false`); offline tests also use `--no-env-file` and an environment allowlist. Production commands use `--no-env-file`.** Keep the app-level configuration: Bun subprocesses started in that directory do not inherit the root configuration. Next.js normally loads `apps/web/.env` (symlink to `../../.env`); isolated E2E disables that separately. Before `bun run db:migrate`, `bun run demo:seed`, or running the worker, export the root env into the shell, e.g. `set -a; . ./.env; set +a`. Quote any values that contain spaces (for example `RECALL_BOT_DISPLAY_NAME="Timeline Bot"`) or bash will try to execute the trailing words when sourcing.
- **The root `bun run dev` script must keep `--env-mode=loose`.** Turbo's strict default strips unlisted env vars from the worker task even after sourcing `.env`. Alternatively run packages separately with env already exported: `bun run --filter @timeline/web dev` and `bun run --filter @timeline/worker dev`.
- Optional URL keys left blank in `.env.example` must use `emptyStringAsUnset` in the shared env schema so the documented shell export flow remains valid.
- Keep a real `OPENROUTER_API_KEY` and `SECRETS_ENCRYPTION_KEY` in `.env` for chat/extraction/embeddings and for `bun run demo:seed` (seed encrypts fake integration credentials).

- **E2E fixture isolation:** remote service URLs require `E2E_REMOTE_FIXTURES=isolated` and disposable synthetic fixtures. E2E ignores ordinary exported authentication, encryption, S3 and Qdrant secrets; custom fixture credentials must use the corresponding `E2E_`-prefixed variables documented in `docs/setup/local.html`. Never use production services for fixture setup or cleanup.

- **Install with `bun run deps` (add `--frozen-lockfile` in CI).** Plain `bun install` can execute dependency lifecycle scripts with a host Node installation. The `deps` script inherits `[run].bun = true`, forcing those scripts through Bun without changing the global Node binary.
