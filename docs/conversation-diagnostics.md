# Conversation diagnostics

This is an explicit support submission, not a complete execution trace or automatic
production capture. The production LangSmith prompt/output guard remains in place.
Synthetic evaluations remain separate; see the [testing policy](testing/README.md).

## User and workspace controls

Team settings links to `/app/diagnostics/settings`. Sharing defaults off; only current owners
and admins can enable it. “Report an issue” in a completed web conversation opens
a message-by-message preview of persisted user/assistant text. Members can uncheck
messages or edit their text individually. Only selected, nonempty message text is
serialized into the submitted transcript; excluded text has no submitted form field.
Changing the description, selection, or message text clears the consent checkbox. Tool payloads, reasoning,
attachments, source documents and system prompts are excluded. Long conversations
must be edited to 60,000 characters; the system does not silently truncate them.

The user describes the failure, removes sensitive text, and explicitly consents.
For answer feedback, they can select unsupported claim, wrong document version,
or missing context. The selected category is included in the encrypted report
and appears during the same audited staff review.
The server checks the consent version, current workspace permission and membership,
and ownership of the active conversation. Text edits are intentional: submitted text
is user-provided diagnostic evidence, not an authenticated model transcript. No new
inference is run. Nothing is submitted merely by opening the preview.

Each member can submit at most ten reports per workspace per day. Deleting reports
does not reset that limit. Senders can delete their active copies from `/app/diagnostics`;
workspace admins cannot read another member’s report. Disabling sharing blocks new
submissions but does not withdraw existing reports. Account/team deletion includes
report rows. Users who have lost access use the [support deletion process](setup/manual-support-deletion.md).

## Storage, staff access and expiry

`diagnostic_reports` stores encrypted description and edited conversation using the
shared AES-256-GCM helper. The authenticated envelope binds report, team and sender.
Non-content fields are report/team/sender IDs, consent version, creation and expiry.
No original session pointer, source payload, provider trace, or training export is
copied. Existing operational usage/error monitoring remains separate.

`/app/admin/diagnostics` paginates unexpired report timestamps. Content
requires a deliberate action by a currently verified, allowlisted platform staff
account. The transactional access audit must commit before plaintext returns.
The UI renders plain text, not HTML/Markdown or automatically fetched links.
Impersonation cannot submit, configure, list or delete a member’s reports.
Staff must not copy submitted text into external tools, logs, tickets, or datasets.
Only synthetic reproductions may be added to regression fixtures.

Access expires after 30 days, even if the worker is unavailable. The existing janitor
prunes up to 500 expired rows per tick and retries on failure. Sender deletion removes
the active database copy immediately; it cannot undo a prior authorized read. Backup
copies and content-free consent/access audit records follow their separate retention
policies. On restore, run expired-report cleanup before enabling application access.
No new provider receives content, and no blanket deletion duration is promised.

## Rollout and verification

Apply migration `0107_diagnostic_reports` before starting the updated app/worker.
The existing `SECRETS_ENCRYPTION_KEY` must be available to both; preserve key custody
and restore procedures. Keep `LANGSMITH_TRACING=false` in production. Owners/admins
must deliberately enable sharing after deployment. The Privacy Policy version is
advanced; the existing publication and acknowledgment gate applies. Legal owner
review and actual production cleanup/access verification remain rollout work.

Tests use synthetic content and real PGlite migrations to cover consent, role and
team boundaries, text-only previews, encryption, impersonation denial, expiry,
deletion, and quota enforcement. Deployment must verify worker scheduling and an
expired synthetic report’s removal before describing cleanup as operationally verified.

## Scope limits

This first flow covers persisted web conversations. It cannot reconstruct discarded
intermediate execution state or diagnose real retrieval recall from text alone.
It introduces no automatic customer-content tracing or model-training permission.
Existing billing/usage metadata is not a complete, correlated diagnostic timeline;
adding richer content-free telemetry is a separate follow-up.

Workspace source-evaluation permission is a separate [settings and retention contract](workspace-evaluation-tracing.md). It never forwards these one-off reports.
