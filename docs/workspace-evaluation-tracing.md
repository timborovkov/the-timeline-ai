# Workspace evaluation tracing

Owner: shared `evaluation-tracing`, Team settings `/app/team/evaluation`, extraction worker.

## Purpose and consent

Synthetic benchmarks cannot reproduce every real source-processing failure. Optional samples let authorized quality reviewers investigate extracted facts and compare model/prompt behavior. This permission is not a model-training license or general staff access to a workspace. One-off [conversation reports](conversation-diagnostics.md) remain separate and are never forwarded by this path.

New workspaces default off. Onboarding links to the same settings disclosure without blocking completion. Current owners/admins can select Telegram, email, Slack, GitHub and Google Drive activity sources. Enabling or updating requires explicit acknowledgment of the current consent version; disabling does not. Permission updates use a fresh membership check under a workspace lock and a content-free audit record. Impersonated operators cannot change permission.

## Collection boundary

Only new **source extraction** calls qualify. Structured GitHub events and Drive activity pulses bypass this worker’s model call; source selection is permission, not a promise that every source event is traced. Every current/context event must belong to the workspace, remain active and team-visible, and come from an enabled source. Both before inference and immediately before export, the runtime checks eligibility and the permission revision. Export serializes against permission changes; an already exporting request finishes before a setting change returns. No backfill is performed.

The sample is a deterministic 10% of anchor event IDs, at most 100 export attempts per workspace per rolling day. A run contains the actual truncated prompt, extraction instructions, structured result or generic failure, model ID, instruction hash and timestamps. No arbitrary source metadata or provider error message is exported. Inputs/outputs are not guaranteed anonymous. Runs over 100 KB or 15 minutes are skipped.

Private/restricted records, original file binaries and full agent/tool traces are excluded. The actual model-facing source text can include attachment names, source URLs and Drive document change excerpts/comments; those are covered by the selected-source disclosure. Agent retrieval can mix private and unselected evidence, so a workspace toggle cannot safely authorize those traces yet. This measures extraction given captured input, not complete retrieval or agent quality. No permanent dataset promotion, replay or training export is automated.

## LangSmith activation and cleanup

`LANGSMITH_TRACING` remains false in production. The scoped exporter additionally requires `WORKSPACE_EVALUATION_TRACING_READY=true`, an explicit `LANGSMITH_WORKSPACE_ID`, and `LANGSMITH_API_KEY`. Before setting ready, record the processor/DPA, transfer and region review, least-privilege account membership, no public sharing/automatic dataset-copy policies, and retention/deletion verification in the [provider register](providers.md). This repository change supplies no evidence that those external controls are configured. Do not turn the flag on until that review is complete.

Projects use `timeline-opt-in-<destination hash>-<workspace UUID>-<permission revision>-<UTC date>`. They are separate from existing `the-timeline-ai`, development and synthetic experiment projects. A content-free database inventory is committed before upload, including cases where a timeout makes upload status uncertain. The exporter does not persist duplicate prompt/output content locally and does not log provider exceptions. LangSmith access is governed by provider permissions, not Timeline's report-read audit.

Janitor schedules project deletion at 30 days from the first eligible run, or earlier on any permission update, workspace disablement or workspace deletion. Failed cleanup retains the inventory for hourly retry without blocking other projects. Recent exports retain cleanup tombstones for 48 hours and recheck hourly, covering late completion after an ambiguous timeout; provider-side retention is still required as a backstop. Team purge waits for provider cleanup; the project table must never be blindly cascaded or manually deleted. Removal requests cover active provider projects; provider backup expiry and asynchronous deletion are not proven by an API response. Keep cleanup credentials available when capture is disabled. A credential or endpoint migration must preserve access to inventoried destinations until cleanup completes.

Use only synthetic records for rollout canaries. Verify export, withdrawal, timeout behavior and provider project removal before permitting customer content. Provider-side retention is a backstop, not a substitute for janitor monitoring. No user data is exported by tests.
