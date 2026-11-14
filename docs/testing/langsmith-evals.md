# LangSmith synthetic benchmarks

Classification experiments call the real single-task classifier through shared
inference. Agent experiments call the real agent with isolated synthetic records,
real database visibility checks, and controlled retrieval responses. Production
models, prompts, and tracing settings remain unchanged. Production feedback
capture and training exports are outside these workflows.

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
