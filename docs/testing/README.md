# Testing

Executable commands live in [package.json](../../package.json); test discovery and isolation live in [the test manifest](../../scripts/testing/manifest.json) and its runner. CI results are the evidence for a particular revision, not a permanent prose inventory.

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
  Changing repository branch policy does not change Railway configuration.

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
  [docs/research/transcription-quality-eval.md](transcription-quality-eval.md).
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



## Local setup and test isolation

Follow [local setup](../setup/local.md) for dependencies, disposable services and E2E fixture requirements. Run a selected file with `bun run test <path-fragment>`. A suite existing does not prove every scenario is covered. Missing product coverage belongs in [the roadmap](../../todo.md); do not keep a second testing backlog.

## Live evaluation

[Transcription evaluation](transcription-quality-eval.md) owns the corpus and promotion gates. Live-provider evidence must name its revision, environment, date and scope without exposing secrets or customer data. Offline CI is not proof of provider or production behavior.

## Live website scan

Start local storage with `docker compose up -d rustfs rustfs-init`, then run
`bun run test:website-scan:live` with `FIRECRAWL_API_KEY` and `OPENROUTER_API_KEY`
exported. Optionally set `WEBSITE_SCAN_LIVE_ENV_FILE` to a private env file and
`WEBSITE_SCAN_LIVE_URL` (default `https://thetimeline.cc`). This incurs real provider
usage. The opt-in test uses a disposable migrated PGlite database and a unique local
S3 bucket, removed after the test; it refuses remote storage. It runs real Firecrawl,
extraction, and suggestion generation and checks page snapshots, documents, cited
pending Company proposals, and absence of canonical objects. Worker dispatch is
inline; Redis/browser transport and vector indexing are outside this test.
Local S3 defaults follow Compose; override with `WEBSITE_SCAN_LIVE_S3_ENDPOINT`,
`WEBSITE_SCAN_LIVE_S3_ACCESS_KEY_ID`, and `WEBSITE_SCAN_LIVE_S3_SECRET_ACCESS_KEY`.

## Freshness and conflict-context verification

Changes to evidence ranking require deterministic source-date, weak upload-date,
historical-query, pagination and visibility regressions plus `bun run test:eval`.
The live agent suite's supplied vector hits do not verify actual retrieval:
exercise real embeddings and isolated Qdrant points with `bun run test:freshness-eval:live` (`OPENROUTER_API_KEY`, local `QDRANT_URL` and its API key). Set `FRESHNESS_EVAL_REPORT` to save the synthetic evidence report. Use synthetic
cross-source examples, including Telegram corrections, and clean up the unique
fixture collection afterwards. Record baseline/candidate recall and p95 across
30 repeated queries after three warmups per mode, without concurrent validation jobs; the release target is no required-evidence loss and no more
than 25% p95 retrieval regression. Repeat each critical live answer scenario
three times and require correct citations and current/pending distinctions.

Browser verification covers approval evidence links, revision/acceptance and the
subsequent answer, plus Help/FAQ navigation and responsive themes. Missing live
prerequisites or a failed quality/latency gate remain unverified release evidence;
offline tests and screenshots do not substitute for them.
