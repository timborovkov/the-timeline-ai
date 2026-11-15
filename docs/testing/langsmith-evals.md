# LangSmith synthetic benchmarks

Classification experiments call the real single-task classifier through shared
inference. Agent experiments call the real agent with isolated synthetic records,
real database visibility checks, and controlled retrieval responses. Experiments do not change production configuration or collect production inputs.
Application policy changes are reviewed in source separately from model comparisons.
Production feedback capture and training exports are outside these workflows.

## How Git and LangSmith fit together

Git is the source of truth for synthetic inputs, expected outputs, splits, and
scoring rules. LangSmith stores a versioned copy of each split and the experiments
run against it. A dataset is the question/reference collection; an experiment is
one model run with outputs, traces, and feedback scores.

Open **Datasets & Experiments** in LangSmith, choose a versioned dataset, then an
experiment and an individual case to inspect its trace and scores. The application
projects `timeline-development` and `the-timeline-ai` are separate trace destinations;
benchmark datasets do not need to be duplicated into both projects.

Both compare commands sync their selected split before running. The explicit sync
commands only upload/verify datasets and make no model calls. Sync is command-driven,
not a background service: changing fixtures in Git does not immediately upload them.
After reviewed fixture changes, commit them and sync each intended split, or run a
comparison. Existing versions and experiments remain available. Do not edit labels
in LangSmith or copy user-submitted diagnostic reports into these synthetic datasets.

## Datasets and splits

The classification corpus contains 400 cases: 240 development and 160 held-out.
All 120 previously inspected fixtures remain in development. Cases cover every
category, ambiguous and conflicting context, multiple business functions, typos,
abbreviations, multilingual text, long inputs, specialist vocabulary, and injection.
Labels describe work visible after packet truncation; rationales explain the label.

The agent corpus contains 60 cases, split 30/30. Each split has five cases for
missing evidence, contradictions, stale evidence, citations, permissions, and tool
failures. The harness migrates an isolated in-memory PGlite database, resets it
between cases, and injects synthetic search hits through the existing retrieval
seam. Actual team scope filters records, including private, restricted, and foreign
workspace records returned by deliberately overinclusive retrieval. Embeddings and
retrieval ranking are controlled, so this benchmark does **not** measure retrieval
recall. Existing end-to-end freshness evaluations remain separate.

Stable case IDs, family IDs, scenario tags, split assignments, and rationales live
in Git. Keep related examples and paraphrases in one split. Never move inspected
development cases into held-out. Automated checks catch exact duplicate content
and family overlap; semantic overlap and label quality still require review.

## Run

Use pinned Bun and `bun run deps --frozen-lockfile`. Set `LANGSMITH_API_KEY` and,
for comparisons, `OPENROUTER_API_KEY` in the environment. Optional
`LANGSMITH_ENDPOINT` and `LANGSMITH_WORKSPACE_ID` select the region/workspace.
Never place credentials in command arguments or reports.

```sh
bun run eval:sync
bun run eval:agent:sync
bun run eval:compare --limit=2 --out=/tmp/classification-smoke.json
bun run eval:agent:compare --limit=1 --out=/tmp/agent-smoke.json
```

Both runners default to `--split=development --repeats=1`. Repetitions must be
between 1 and 10. `--limit` selects the first N cases within the selected split and
marks the run partial. Use new output paths; existing reports are never overwritten.

For frozen held-out comparisons:

```sh
bun run eval:sync --split=held-out
bun run eval:agent:sync --split=held-out
bun run eval:compare --split=held-out --repeats=3 --candidate=deepseek/deepseek-v4-pro-0813 --out=/tmp/classification-held-out.json
bun run eval:agent:compare --split=held-out --repeats=3 --out=/tmp/agent-held-out.json
```

Classification always includes its pinned baseline; repeat `--candidate` to add
models. Agent runs use the configured agent baseline and existing fallback policy;
reports retain requested and served model IDs when available. Candidate access
requires provider permissions. Do not widen production key restrictions for evals.

Sync names datasets by corpus hash and split. Repeated sync repairs interrupted
uploads and rejects duplicate IDs, changed reference outputs, or unexpected examples.
Old versions remain intact. Run one sync per dataset at a time. Edit fixtures in
Git, never in LangSmith; remote text is never executed as model input.

## Scores and interpretation

Classification reports include exact accuracy, macro recall, category and scenario
scores with denominators, failed case IDs, execution failures, and p95 latency.
Every failed call counts as incorrect. Full held-out runs retain the existing gates:
accuracy ≥85%, macro recall ≥80%, and injection accuracy 100%. Development and
partial runs cannot pass a release gate. Paired comparisons report baseline wins,
candidate wins, and disagreements separately for each repetition. Repeated answers
are not independent new cases and are not pooled into a larger sample size.

Agent feedback scores execution, structured facts and their authority, structured citation IDs,
permissions, tool selection, and failure handling separately. Required citations
must identify visible fixture records; forbidden content or tool actions are hard
failures. Benchmark questions request JSON containing an answer status and scalar claims,
authority states, and per-claim citation markers. Scoring rejects extra claims,
authority inversions, unsupported or malformed citations, and extra fields/prose.
This deliberately constrained response contract does not evaluate free-form writing
quality. Inspect failed criteria and answer text together. No LLM judge is used. Agent scores are diagnostic;
there is no aggregate model-promotion threshold. Any failed agent case, execution
failure, missing feedback, or classification held-out gate returns nonzero.

Timeouts, rate limits, malformed JSON, invalid categories, and missing/duplicate
batch results also have deterministic tests. Injected agent retrieval failures
exercise how the agent handles unavailable evidence; they do not measure provider
retry behavior. The agent only has read-only tools and no external MCP discovery.

Each experiment records Git revision, dirty status, corpus hash, split, repetition,
evaluation time, evaluator version, and prompt hash/version. Commit fixtures and
scoring rules before held-out runs. LangSmith experiments and dated reports form
the evaluation history: once results have been inspected, future tuning must not
claim that same corpus is fresh held-out evidence. Create a new version containing
fresh held-out families after tuning; keep historical results and failures.
If a reference/scoring defect is corrected, retain the original experiment and
identify any saved-output rescore with its source experiment and new corpus/revision.
A rescore is not another model execution or fresh held-out evidence.

Classification runs four concurrent cases per model; agents run sequentially to
isolate database state. Latency includes retries and is diagnostic, not a controlled
load benchmark. LLM traces carry usage when available; reports do not aggregate
provider cost. Missing cost is not zero.

## Data boundary

Only checked-in synthetic fixtures are eligible. Commands reject production mode
and enable rich tracing within the eval process. They require no production data
store. Retention and access follow the selected LangSmith workspace; these commands
do not change account settings or establish training consent. See the
[security standard](../security-privacy-trust.md).

## Suggestion pipeline benchmark

`bun run eval:suggestions:sync --split=development` publishes the synthetic
suggestion corpus using the same immutable corpus-hash/split naming convention.
Use `--split=held-out` to sync the other split. Existing datasets are preserved.

```sh
bun run eval:suggestions:compare --split=development --repeats=1 --out=/tmp/suggestions-dev.json
bun run eval:suggestions:compare --split=held-out --repeats=3 --out=/tmp/suggestions-held-out.json
```

The corpus contains 53 authored scenarios (33 development / 20 held-out), including
positive commitments and requests, multiple actions, lifecycle changes, explicit
assignments and deadlines, noise, completed work, retries, private context, and
injected instructions. Cases define expected operations, target IDs, intent term
groups, structured fields, and rationales. Intent terms allow synonymous titles;
no exact prose comparison or LLM judge is used. These references have consistency
checks, not independent human validation. Review disputed matches before drawing
model-selection conclusions; this small initial corpus is not a promotion gate.

The harness uses migrated disposable PGlite records, the real event dispatcher,
conversation scheduling, proposal validation/persistence, and workspace-scoped
pending-suggestion reads. An in-memory queue drains the scheduled review after
advancing its synthetic quiet window. Live runs call the current extraction model
through shared inference, including reconciliation planning. Task-category
classification, vector retrieval and evidence-pack construction are disabled to
isolate proposal behavior. The harness uses the application extraction policy; it does
not replace the prompt with an evaluation-only prompt. Model configuration is unchanged.

Success means required actions reach the visible approval queue with the expected
structured fields and source IDs. One-to-one matching counts missed actions and
unmatched proposals separately. Deadline cases permit at most one optional calendar
companion with matching intent and start time; extra or incorrect companions remain
noise. Empty output remains in the denominator. Provider
errors remain failures even if the worker catches them and produces fallback
output. Private source leakage, invalid evidence IDs, or canonical entity mutation
before approval are hard failures. Reports include individual outputs, execution
errors, scenario denominators, missed/noisy action counts, latency and observed
harness stages. These stages identify dispatch, inference and visibility-read
progress; they are not a complete internal rejection-reason taxonomy.

Each repetition is reported separately; repeated answers are not independent
examples. Only a complete held-out run with all feedback is marked benchmark
evidence. Dirty working trees cannot run held-out evaluation. Preserve original
experiments and reports after inspection; do not tune on these cases and later
claim they are fresh holdout evidence. Execution failures or unsuccessful cases
return nonzero without weakening expected outcomes.

Most cases start at captured raw events. Forwarded-email cases additionally exercise
the real inbound-email dispatcher, local forward parsing and suggestion enqueue
boundary with synthetic normalized receiving payloads. They do not exercise SMTP
or webhook authentication/transport. This suite does not measure live connector ingestion,
real retrieval recall, browser rendering, queue load or wall-clock delivery SLA.
Nine development-only GitHub completion cases exercise the raw-event and coalesced
`github_task_proposal` worker routes: merged/closed PRs, completed tasks, duplicate
jobs/events, ambiguous title matches, partial work linked to a separate issue,
new completed tasks, repository identity and private source suppression. They
check visible approval items and unchanged canonical entities. These deterministic
cases need no model calls. They start from captured event metadata, so GitHub
webhook transport and ingestion remain outside this benchmark. Drive lifecycle
cases still cover safe suppression only, not opted-in document extraction. Existing live proposal-engine and document
freshness/end-to-end suites remain separate. Extend this corpus with those paths
before claiming full source coverage.

All published inputs are synthetic. This benchmark does **not** broaden production
trace collection or reinterpret existing workspace consent. Production pipeline
rejection diagnostics remain separate work requiring a collection contract and
matching disclosure/consent before activation; see
[workspace evaluation tracing](../workspace-evaluation-tracing.md).

To run only the GitHub completion slice:

```sh
bun run eval:suggestions:compare --tag=github-completion --out=/tmp/github-completions.json
```

`--tag` selects a diagnostic subset of the versioned split, with `--limit` applied
inside that subset. It never qualifies as a complete held-out benchmark. The
GitHub-only slice requires LangSmith credentials but no OpenRouter key. The nine
related cases stay in development; changing the corpus hash does not make the
previously inspected held-out examples fresh again.

The `--tag=forwarded-email` development slice covers explicit and informal customer/
project context without new tasks, requests inside forwarded bodies, and unrelated
company mentions. Optional company/project relationships must resolve by name or
same-bundle references to the expected pair; arbitrary relationships count as noise.
The owning policy is [the memory engine](../relational-memory.md#identity-artifacts-and-hubs).
These cases are diagnostic tuning examples. Historical held-out scores predate the
email-policy change and are not new evidence for it.

## Communications and approval benchmark

Use `--suite=communications` on the suggestion sync/compare commands for the
separate 96-case communications corpus. The default remains `--suite=suggestions`;
its historical datasets and experiments are unchanged.

```sh
bun run eval:suggestions:sync --suite=communications --split=development
bun run eval:suggestions:sync --suite=communications --split=held-out
bun run eval:suggestions:compare --suite=communications --out=/tmp/communications-dev.json
bun run eval:suggestions:compare --suite=communications --split=held-out --repeats=3 --out=/tmp/communications-held-out.json
```

Thirty semantic families have email, Slack and Telegram variants; six additional
families cover email packaging. There are 64 development cases and 32 held-out
cases, with whole families assigned to one split. Cases cover combined account,
project and task creation; aliases and pending objects; corrections; ownership;
prospects and difficult negatives; injection, privacy and retries; and forwarding
formats, multilingual content and long inputs. References include initial state,
message sequences, expected approved objects and relationships, and rationales.
These rationales receive consistency review, not independent human validation.

The harness drives the real local email, Slack and Telegram dispatchers using
synthetic provider payloads, controlled transports, real routing/authorization,
and disposable migrated PGlite databases. Ordered messages and review boundaries
exercise pending-state refinement. A controlled queue drains actual worker jobs;
real scoped APIs read the approval queue and accept proposals. Foreign-workspace
acceptance is attempted and must fail. No canonical mutation is permitted before
approval. Summary refresh jobs, vector indexing, external delivery, production
stores and wall-clock delivery performance are outside the boundary.

The scorer checks the approved object graph: identity reuse, lifecycle, explicit
assignee/deadline assertions, and task/project/account relationships. Counts are
**graph assertions**, including preservation of seeded objects, rather than task
recall estimates or independent samples. Named fixture objects use their synthetic
identity; task intent uses term groups rather than exact prose. Extra objects,
incorrect relationships, duplicate proposals and unsupported action kinds are
noise. A uniquely grounded company/project association may be optional. A task
deadline may have a matching calendar companion; unsupported dates remain noise.
Missing work, acceptance failures, lost required packet content and inference
errors cannot pass. Privacy violations, invalid evidence and automatic changes to
human-edited pending proposals are hard failures. Prospect proposals must express
uncertainty and concrete proposed projects must remain `planning`.

Communications run four cases concurrently, each with a separate disposable database
and queue; report writes are serialized. Reports retain an implementation digest,
per-case outputs, source/family/scenario denominators, latency,
execution and approval failures, packet loss, and each repetition separately.
Source variants within a family and repeated runs are correlated; do not pool them
as independent evidence. `--tag` and `--limit` are diagnostic only. Complete held-out
runs require committed fixtures/scoring and full feedback; inspected holdouts must
remain in evaluation history and cannot become fresh evidence after tuning.
