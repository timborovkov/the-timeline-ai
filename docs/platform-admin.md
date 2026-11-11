# Platform administration

The `/app/admin` panel is available only to signed-in users whose current database
email is verified and appears in the comma-separated `PLATFORM_ADMIN_EMAILS`
allowlist. Email matching ignores case and surrounding allowlist whitespace. A
team owner or team admin does not receive platform access. An empty allowlist
provides no access. The panel has its own layout, so platform admins need no team
membership. The workspace header links to it only for eligible administrators.

Users and teams have searchable, sortable, filterable directories, 50 records per page, visible copyable UUIDs, and linked membership details. Team rows show disabled dates when known. Operators can edit display names and team names, change
non-owner member/admin roles, remove non-owner members, and suspend or restore
users and teams. Billing remains at `/app/admin/billing`. Owner changes,
invitations and email/password changes are not part of this panel. Team disabling, deletion requests, permanent cleanup and retention follow-up are described below. Membership removal reuses the existing
billing revocation, integration, calendar, and chat-routing cleanup.

## Impersonation

Choose an active member from a team or user detail page. Record the purpose,
support/incident reference, and customer authorization and approving person (or
emergency context) before starting a 30-minute session. Follow the
[human-access standard](security-privacy-trust.md#5-human-access-to-hosted-customer-data);
the form records authorization context, it does not independently verify approval.

The original login stays intact. A separate HttpOnly, SameSite cookie holds an
opaque token; only its SHA-256 hash is persisted. The selected member retains
their actual role and visibility, including their private content. Impersonation
does not reveal other members' private content or grant owner rights to a member.
A persistent banner identifies the selected account and team. Exit uses a full
navigation to discard cached workspace data and restores the original context.

Every request rechecks the actual admin, target membership epoch, expiry, and
suspension. The request context separates the actual administrator from the
effective user. Team scopes retain their normal membership and visibility checks;
queued work carries the impersonation-session identifier and revalidates it at
execution. Work that starts after exit, expiry, or revocation is rejected.
Account-security, credential, OAuth connection, provisioning, and legal
acceptance actions cannot run on another person's behalf. Account-wide
provisioning grants and audit history are blocked for impersonated reads as well
as writes. Platform management and billing use the actual administrator identity.

## Suspension and audit

User suspension blocks sign-in and existing authenticated access. Team suspension
blocks workspace access and new ingestion/AI processing while retaining data.
Suspended and terminated workspaces are omitted from the team selector, active-team
resolution, and Telegram/Slack team pickers so a member cannot choose them; the
team-switch route still rejects those workspaces as defense in depth. A cookie that
still names a suspended team does not hide the member's remaining selectable teams.
Security state remains separate from billing; restoration preserves other billing
restrictions and the prior team security state. Disabling a team records cancellation of subscription renewal for retry by the lifecycle worker. New processing, storage and member usage accrual stops. Restoration never silently resumes renewal; previously incurred charges remain payable without automatic refunds. System cleanup and billing reconciliation remain
available. The panel cannot suspend the operator or another allowlisted admin.

Suspended accounts and teams allow read-only impersonation inspection. The
request, scoped operation, database-write, and job-admission boundaries block
mutations and new work. Previously issued external signed URLs retain their
existing expiry; suspension does not revoke a provider URL already issued.
Read-only inspection includes team metadata and unread notification counts.
Document preview/download server actions are explicitly classified as reads at
the server-action boundary; POST alone does not imply a write. Other actions stay
blocked, and normal scoped visibility checks still apply.
Document finalization stores its initiating operator session in the immutable
upload event. Extraction admission recovers that attribution from the document
version even when janitor recovery reconstructs an otherwise unattributed job;
expired, ended, or missing sessions cannot resume the work. Global object-cleanup
sweeps skip suspended teams so active teams continue processing.
Scoped operations declare exhaustive capabilities in
`packages/shared/src/platform-admin/workspace-policy.ts`; method names do not
determine read, write, account-management or maintenance permission. Web identity
entrypoints explicitly install the request-context resolver before resolving an
effective identity.

Suspension admission runs at each scoped operation's entry. Nested helpers reuse
that operation's admission to avoid querying an outer connection from inside a
transaction; a later operation on the same scope checks current suspension again.
Private document and event detail reads may append their specific product audit
records during suspended inspection; audit updates and arbitrary inserts remain
blocked. Verified operator billing remains available for suspended teams through
its separate administrator checks. Meeting scheduling excludes suspended teams
and creators before applying the global batch limit.
Webhook suspension failures retain failed target status for the existing retry
and recovery flow instead of stranding targets in processing. Digest scheduling
omits suspended and terminated workspaces, and suspended users, when listing
recipients and shared destinations. Already-queued digest jobs for a suspended
principal complete as skipped with an info log: they are not retried and are not
reported to Sentry. Digest delivery rechecks the stored recipient and workspace
security state before selecting any delivery channel; already-generated digests
are skipped if either is suspended.
Rate-limited chat digests retain their team and recipient in the encrypted deferred
delivery envelope and queue routing metadata. The retry worker checks suspension
again before any Slack or Telegram request.

Platform audit records cannot be edited and are deleted only under the retention
rules below. They record management changes, support
session lifecycle, request attempts, scoped operations, and attributed job
execution. It records real and effective actor identifiers without copying
customer content, credentials, or request query strings into audit metadata.
An expired session is recorded when subsequently resolved; expiry is enforced by
time comparison even if no later request arrives.

## Implementation and rollout

Current Terms/Privacy versions and renewed-acceptance requirements are owned by `packages/shared/src/legal-versions.ts`. Historical retention approval is recorded in [the dated decision](evidence/platform-retention-decision-2026-11-03.md); it does not override later publication changes.

## Record retention and legal holds

Access expiry and record retention are separate. A support session permits access
for at most 30 minutes. The janitor removes its record 30 days after the earlier
of `ended_at` and `expires_at`. It removes platform audit records 12 calendar
months after creation, including audit copies of purpose, reference, and
authorization context that outlive the session row. Each tick removes at most 500 records of each kind; a
backlog or failed tick is retried by subsequent scheduled maintenance. Monitor
`janitor: platform record retention failed` errors and successful deletion counts.
No customer workspace content, accounts, or subscriptions are deleted by this job.

Audit updates remain prohibited. The database permits deletion only after the
12-month period and only when no applicable active hold exists. Cleanup and hold
changes serialize on the holds table to prevent a hold from being added between
eligibility checking and deletion. All of this maintenance remains available for
suspended accounts and teams.

A documented legal hold can preserve records associated with a user (as staff
actor, effective user, or audit target) or a team (as team or audit target). It
preserves both session records and audit records and never extends access. Only
a verified allowlisted operator can place or release a hold through the operator
script. The script is for a trusted, named operations environment with database
credentials, not an end-user API; actor arguments identify the responsible
operator and do not replace infrastructure authentication. Both actions are
audited. Keep reasons and references concise; do not include customer content or
credentials. Review active holds at least quarterly and release them when the
legal obligation ends. Released hold documentation is deleted after 12 months.

With the approved environment already loaded, use:

```sh
bun --conditions=development scripts/platform-admin-retention.ts place \
  --actor-user-id "$OPERATOR_USER_ID" --actor-email "$OPERATOR_EMAIL" \
  --team "$SUBJECT_TEAM_ID" --reason 'Preserve records for documented legal matter' \
  --reference 'LEGAL-123'

bun --conditions=development scripts/platform-admin-retention.ts release \
  --actor-user-id "$OPERATOR_USER_ID" --actor-email "$OPERATOR_EMAIL" \
  --hold "$RETENTION_HOLD_ID" --reason 'Legal owner authorized release: LEGAL-123'
```

Use `--user` instead of `--team` for a user hold. Retain the returned hold ID in the
restricted legal case record. Place required holds before retention cleanup runs;
a hold cannot restore records already deleted. Privacy requests require a review
of applicable retention obligations and holds; do not promise immediate erasure
of security evidence. Backup and disaster-recovery retention remain separately
controlled. Restore procedures must reapply current holds and rerun retention
before restored records are made available for normal use.

Apply `0094_platform_admin_retention` after `0093_platform_admin` and before
starting the updated web and worker processes. This PR does not run production
cleanup or apply production migrations.

## Retention authority

[The dated retention decision](evidence/platform-retention-decision-2026-11-03.md) records approval. Current legal versions are source-owned; do not reuse its historical publication instructions.

## Team deletion lifecycle

Normal product work ignores inactive workspaces: `disabled_at`, `deletion_started_at`,
`deleted_at`, or legacy billing security state `suspended`/`terminated` blocks admission.
Global discovery and recovery scans apply the shared active-workspace predicate before
batch limits, including reminders, digest recipients, integration polling/renewal,
deferred enrichment, health checks and janitor recovery. Queued workspace jobs finish
as skipped on lifecycle denial; unrelated authorization and infrastructure failures
still fail. Skipping must not update workspace content or send notifications.
Overdue reminders recheck admission under a workspace lock and insert per workspace,
so disabling one workspace cannot roll back another workspace's reminders.
Explicit lifecycle cleanup, credential revocation, retention and reconciliation of
previously incurred billing remain the documented maintenance exceptions.

Owners request permanent deletion under Team settings → Advanced after typing the team name and acknowledging loss of access for every member. Export first using normal visibility permissions. The request immediately disables the team and persists notifications for platform admins and the requester. Only platform admins can withdraw the request and restore access. The admin Teams directory has a deletion-request filter.

Platform admins may start permanent deletion with or without an owner request. Confirmation requires the team name and a reason. Once started, deletion cannot be reversed or impersonated. The detail page exposes cleanup status and retries, not workspace content. A one-minute dedicated lifecycle worker polls durable database state, so missing queue publication cannot lose a request.

Cleanup removes legacy board/object provenance history in bounded batches before unlinking its parents. It inventories shared references, stops bots, cancels renewal and pending checkouts, disconnects sources, removes team-owned rows, versioned objects, vectors, queue payloads and caches, then verifies after a 24-hour late-producer window. Recoverable failures keep access blocked and retry with bounded backoff. Revoked or inaccessible provider webhook authorization is recorded as a pending processor follow-up with subscription identifiers; local erasure can continue without claiming provider cleanup succeeded. The verification window cannot be bypassed by the retry button. The worker only removes personal connector credentials and Slack installations when other teams do not use them. User accounts, sign-in credentials and original provider files remain.

Verified account-level Slack/Telegram switching can deactivate old routing, cancel its pending turn and archive its session while a team is disabled. This narrow terminal-state exception cannot change identities or content, reactivate routing, or deliver answers.

The team row becomes a minimal tombstone; retired inbound identities cannot be reused. Platform security evidence and financial records remain under their documented retention and applicable holds. Reconnecting a shared personal connection updates only active teams and preserves disabled-team state. A personal connection owner can still remove their credential when another linked team is disabled; that account-owned cleanup disables affected sources without restoring workspace processing or creating notifications in disabled teams. Backups, processor copies and retained records have explicit operator follow-up status, references and expiry/review dates. “Active-system data removed” is distinct from completion of those follow-ups. Never assert all copies are erased based solely on a completed worker stage.

Apply `0104_team_lifecycle` before updated web and workers. Drain old workers before permitting permanent deletion; old binaries do not understand lifecycle admission. Review and publish the accompanying legal versions through the existing publication gate. Source changes and disposable rehearsals do not prove production deployment, backup expiry or processor deletion. Do not roll back to binaries without lifecycle checks after accepting a deletion.

For pre-migration suspended teams without a reliable suspension audit, the migration records an enforcement timestamp and labels the original disable date **Unknown**. Unrecorded daily usage from an unknown suspension history is waived rather than reconstructed from an invented active period; existing financial records remain payable. It schedules renewal cancellation for all historically suspended/terminated teams; deletion of a billing row cannot remove the access block.
