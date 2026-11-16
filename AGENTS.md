# Agent instructions

This is the repository operating contract. Explicit user instructions take precedence. Use [the documentation index](docs/README.md) to find the owning reference before changing behavior.

## Validation and delivery

- Follow [CONTRIBUTING.md](CONTRIBUTING.md) for human-owned branches, simple PR titles/descriptions, and the required Codex review loop.

- Shared compiler options live in `tsconfig.base.json`. Preserve `erasableSyntaxOnly`: no enums, value namespaces, constructor parameter properties, or `import =` / `export =`. Keep existing target/lib versions; add `verbatimModuleSyntax` only for a demonstrated need. TypeScript 7 compilation uses `@typescript/native`; compiler-API consumers use the TypeScript 6 compatibility package.
- Use Bun pinned by `.bun-version`; no npm, pnpm or yarn. Install with `bun run deps`.
- Scope local checks to changed behavior. Prose-only work needs changed-file formatting, links and diff review, not application suites. Follow [testing policy](docs/testing/README.md) for change-specific tests and live evaluations.
- GitHub owns broad validation. Required checks gate merging, not commits, pushes or PR creation. Never bypass or weaken checks; report pending and unrelated failures accurately.
- `main` is development; release through a PR to protected `production`. Deployment remains a separate authorized action. Repository branch names do not establish what Railway currently runs.
- React Doctor verification requires both score 100 and “No issues found”; an exit code without a score is insufficient.
- Application execution and tests use Bun. Record necessary analyzer/build exceptions in validation evidence, not as product instructions.

## Documentation ownership

- Update the owning current contract when behavior changes; link to it elsewhere instead of copying rules, lists or status.
- Keep `todo.md` open-only. Remove completed items in the completing change, preserving any genuinely unfinished subtask. Git/PR/CI retain routine completion history.
- Do not append test pass counts, branch merges or review-cycle narratives to current docs. Preserve unique dated external evidence separately from instructions.
- At handoff, apply `document-release` to affected docs and inbound links. A full documentation audit is required only when explicitly requested or when a concrete cross-cutting change requires one.
- Never infer deployment, provider settings, legal approval or completed deletion from source code. Keep unresolved evidence gaps explicit.
- Prefer Markdown for internal authoring. Runtime email HTML and distributed product skills are product artifacts, not prose-cleanup targets.

## Non-negotiable boundaries

- Every workspace query uses `withTeam(db, teamId, userId)` and its named modules; Qdrant queries use the team-filtering wrapper. Owner/admin roles never bypass private or restricted visibility.
- Account provisioning and platform administration have separate verified privilege boundaries. Preserve real-actor attribution during impersonation and jobs; scoped operation capabilities are explicit.
- Captured source content is immutable. Derived calendar mirrors follow the calendar contract. Canonical proposals remain approval-backed; pulse signals cannot originate proposals.
- Use the shared inference layer. No direct provider SDK calls from app/worker code. Preserve evidence fencing, tool authorization and surface-specific answer presentation.
- Encrypt integration/OAuth secrets through `crypto/secrets.ts`. Validate external URLs through the MCP SSRF guard. Never place secrets or customer content in logs, fixtures or docs.
- Before changing providers, data flows, telemetry, retention, access or legal/trust claims, apply [the security standard](docs/security-privacy-trust.md). Public claims cannot exceed evidenced controls.
- Follow [domain ownership](docs/architecture/ownership.md) for lifecycle/transaction boundaries and [the memory engine](docs/relational-memory.md) for signal/authority rules.
- Follow [design.md](design.md) and its relevant component/screen references for UI. Intentional design changes update that owner in the same change.
- Production vector copies, schema upgrades, deletion and snapshot cleanup follow their runbooks; never delete a volume or bypass a deployment inventory to repair startup.
- Use `@/` for web source imports, `#src/` inside worker/shared/db packages, and exported `@timeline/*` subpaths across packages.

## Skills

Repository workflows live in [.agents/skills](.agents/skills/README.md); the consumer plugin under `plugins/timeline` is separate. Read a skill and relevant references before using it. A skill listing is not proof that its tools, credentials or external services exist.

- Completion: `document-release`; shipping only when requested: `ship`.
- Review: `diff-review`; test design: `test-strategy`; bugs: `diagnosing-bugs`.
- UI: `interface-review` when explicitly invoked, or `better-interface` and its focused domains for a broader audit.
- Context handoff: `handoff` only when requested. Structural refactoring: `untangle-codebase` only when requested; scoped cleanup: `deslop`.
- Integration: `upstream-sync`; external library docs: `find-docs` after bundled Next.js docs; infrastructure: `use-railway` only for authorized operations.
- If a skill requests unavailable delegation/tools, perform relevant work serially and report the limitation.

## Environment

[Local setup](docs/setup/local.md) owns dependencies, Compose, environment loading and disposable E2E fixtures. [Demo corpus](docs/demo-corpus.md) owns seed commands and synthetic accounts. [Railway](docs/railway.md) owns deployment. Read those procedures rather than copying their values here.

In managed cloud environments, Docker may need an explicitly started daemon; check health before running dependent commands. Never use production stores for test fixture setup or cleanup. `apps/web/AGENTS.md` contains the Next.js prerequisite and is generated by the installed framework.
