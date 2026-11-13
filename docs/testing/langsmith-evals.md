# LangSmith classification experiments

The first LangSmith benchmark covers the repository's synthetic task-category
fixtures. It calls the real single-task classifier through shared inference;
production model defaults and production tracing remain unchanged. Agent workflow
experiments, production feedback capture and training exports are not implemented
by this runner.

## Run

Use the pinned Bun and install dependencies with `bun run deps --frozen-lockfile`.
Provide `LANGSMITH_API_KEY` and, for comparisons, `OPENROUTER_API_KEY` through the
environment. Optional `LANGSMITH_ENDPOINT` and `LANGSMITH_WORKSPACE_ID` select the
account region/workspace. Never put keys in command arguments or reports.

```sh
bun run eval:sync
bun run eval:compare --candidate=<model-id> --out=/tmp/classification-comparison.json
```

Sync creates a dataset named with a hash of the complete fixture corpus. Repeated
syncs reuse matching examples and repair interrupted uploads. Unexpected examples,
duplicate case IDs or changed reference labels are rejected rather than overwritten.
Do not edit these datasets in LangSmith; edit fixtures in Git and sync a new version.
Run one sync at a time. Dataset inputs identify local cases; the runner never sends
arbitrary remotely edited text to a model. Synthetic task text is inspectable in
example metadata and model traces.

Compare always includes the pinned production classifier model. Repeat `--candidate`
to compare additional models on identical cases. Candidate access depends on the
OpenRouter key's permissions and provider availability; do not widen a production
key's model restrictions for this benchmark. Use an evaluation key if necessary.

For an inexpensive connectivity check:

```sh
bun run eval:compare --limit=2 --out=/tmp/classification-smoke.json
```

A limited run is marked partial and cannot pass the release gate. Full runs use the
existing thresholds: exact accuracy at least 85%, macro recall at least 80%, and
100% accuracy on injection cases. Failed calls count as incorrect and are reported
separately. A failing full-run gate or failed call produces a nonzero exit status.
Reports refuse to overwrite an existing file. Each experiment records the Git
revision, dirty-worktree status, corpus hash, system-prompt hash and evaluator
version. Use a clean committed revision for promotion evidence; the revision also
identifies packet construction, schemas and inference settings.

Inspect per-case labels and execution scores in LangSmith, and per-category recall,
p95 call duration and release gates in the JSON report. Duration includes retries
inside shared inference. LLM child traces carry SDK usage information when available;
the local report does not yet aggregate token counts or provider-reported costs.
Do not interpret missing cost data as zero. Model candidates run sequentially, with
four concurrent cases per model; this is a quality comparison with diagnostic latency,
not a controlled load benchmark.

## Data boundary

Only the checked-in synthetic corpus is eligible. The command refuses production
mode and enables rich tracing only within its evaluation process. It requires no
database service and supplies local schema placeholders for database/auth settings
when absent. Do not use customer data or production configuration for this command.
Retention and access follow the selected LangSmith workspace; this workflow does
not change account settings or establish training consent. See the
[security standard](../security-privacy-trust.md) for production collection rules.
