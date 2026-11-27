# Agent instructions

**The Timeline** connects the tools a team uses and keeps that activity together so people can ask what they need or open a view to explore it. Team members operate each workspace; the workspace owns captured activity, linked projects/people/tasks, visibility and proposed changes awaiting review. AI agents read the same record and contribute progress back through the MCP and plugin surface. Integrations and coworker connections are configurations of one product, not separate products.

Hosting is multi-tenant at thetimeline.cc, with private self-hosting for an organisation’s own use. The stack is a Next.js web app, a Bun worker, PostgreSQL, Redis, Qdrant, S3-compatible storage and a shared OpenRouter inference layer in one repository. Read [the product brief](docs/product-brief.md) and [the memory engine](docs/relational-memory.md) for product and architecture decisions.

Explicit user instructions take precedence over this file. Use [the documentation index](docs/README.md) to find the owning reference before changing behavior.

## Documentation

Most code changes do not need a documentation change. Agents can read the code.

[The product brief](docs/product-brief.md) and [the memory engine](docs/relational-memory.md) own product and architecture decisions. Do not edit them without explicit permission, and do not start a second architecture document. [design.md](design.md) is the interface reference; intentional UI changes update it in the same change. [README.md](README.md) stays light: short product entry, pointers to setup and docs, no feature catalogs or architecture narration.

`docs/` holds maintainer setup, testing, deployment and cross-cutting traps that are hard to discover from the source. Before adding a paragraph, ask whether a maintainer would get this wrong without it. If reading the relevant code answers the question, leave it out.

Do not write feature catalogs; enumerate fields, methods, constants, timeouts or migration numbers; narrate control flow; maintain file catalogs; or append pull-request changelogs. Types, tests and code already record the implementation.

A local reason the code cannot show goes in a short nearby comment. Use `docs/` when the reasoning crosses boundaries or needs context the code cannot carry well. Link to the relevant source instead of copying it.

When a documented decision or constraint changes, rewrite or remove the affected text. Do not append another account of the new behavior. A new page needs a distinct, durable reason to exist.

Keep `todo.md` open-only: remove completed items in the completing change. Never infer deployment, provider settings, legal approval or completed deletion from source code; keep unresolved evidence gaps explicit. Prefer Markdown for internal authoring. At handoff, apply `document-release` to affected docs and inbound links; a full documentation audit only when asked or when a concrete cross-cutting change requires one.

## Validation and delivery

- Shared compiler options live in `tsconfig.base.json`. Preserve `erasableSyntaxOnly`: no enums, value namespaces, constructor parameter properties, or `import =` / `export =`. Keep existing target/lib versions; add `verbatimModuleSyntax` only for a demonstrated need. Typecheck uses `bun check` (TypeScript 7 semantics). Emit uses `tsc` from `@typescript/native` (`typescript@7.0.2`). The `typescript` package name stays on `@typescript/typescript6` for compiler-API consumers (`typescript-eslint`, test AST helpers) until those peers accept TypeScript 7.
- Use Bun pinned by `.bun-version`; no npm, pnpm or yarn. Install with `bun run deps`.
- Scope local checks to changed behavior. Prose-only work needs changed-file formatting, links and diff review, not application suites. Follow [testing policy](docs/testing/README.md) for change-specific tests and live evaluations.
- GitHub owns broad validation. Required checks gate merging, not commits, pushes or PR creation. Never bypass or weaken checks; report pending and unrelated failures accurately.
- `main` is development; release through a PR to protected `production`. Deployment remains a separate authorized action. Repository branch names do not establish what Railway currently runs.
- React Doctor verification requires both score 100 and “No issues found”; an exit code without a score is insufficient.
- Application execution and tests use Bun. Record necessary analyzer/build exceptions in validation evidence, not as product instructions.

## Pull requests

Never open a pull request unless the developer explicitly asks.

Run `git remote get-url origin` before the first forge command and use that host's CLI. When the remote is GitHub, that CLI is `gh`.

Branch names are `<owner>/<type>/<description>`. The owner is the responsible contributor, whichever tool writes the code. Titles are `<type>: <clear outcome>` in plain language, for example `fix: prevent duplicate invitations`.

The body states the problem in a sentence or two, then how it was fixed. When an agent did the work, end with the model and harness. Use the [pull request template](.github/pull_request_template.md) for verification. Before marking ready, review the current diff against its target branch, resolve actionable findings, rerun affected checks, and review new commits again. Record the reviewed commit and result. Do not treat an incomplete review as a pass.

UI changes need before/after images. Motion or timing changes need a short video. Upload that evidence on the pull request. Do not commit screenshots or other assets that exist only for review.

One request is one pull request. Split only when asked. Outside contributions follow [CONTRIBUTING.md](CONTRIBUTING.md).

When babysitting a pull request, act on what is new and end the turn. Do not poll or sleep. Verify each bot finding against the source, fix real ones, and dismiss false positives with a written reason. Stay quiet when nothing is new. Stop when required checks are green on the latest commit.

## Plans and work artifacts

Do not commit implementation plans, research notes, or agent scratch files. Keep temporary material outside the worktree.

Track active maintainer work in its GitHub issue. External proposals use the contribution proposal in [CONTRIBUTING.md](CONTRIBUTING.md). A merged pull request is the implementation record.

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
