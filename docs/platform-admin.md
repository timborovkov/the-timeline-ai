# Platform administration

The `/app/admin` panel is available only to signed-in users whose current database
email is verified and appears in the comma-separated `PLATFORM_ADMIN_EMAILS`
allowlist. Email matching ignores case and surrounding allowlist whitespace. A
team owner or team admin does not receive platform access. An empty allowlist
provides no access. The panel has its own layout, so platform admins need no team
membership. The workspace header links to it only for eligible administrators.

Users and teams have searchable directories, 50 records per page, and linked
membership details. Operators can edit display names and team names, change
non-owner member/admin roles, remove non-owner members, and suspend or restore
users and teams. Billing remains at `/app/admin/billing`. Owner changes,
invitations, email/password changes, permanent deletion, and automatic subscription
cancellation are not part of this panel. Membership removal reuses the existing
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
Account-security, credential, OAuth connection, and legal acceptance actions
cannot run on another person's behalf. Platform management and billing use the
actual administrator identity.

## Suspension and audit

User suspension blocks sign-in and existing authenticated access. Team suspension
blocks workspace access and new ingestion/AI processing while retaining data.
Suspended and terminated workspaces are omitted from the team selector, active-team
resolution, and Telegram/Slack team pickers so a member cannot choose them; the
team-switch route still rejects those workspaces as defense in depth. A cookie that
still names a suspended team does not hide the member's remaining selectable teams.
Security state remains separate from billing; restoration preserves other billing
restrictions and the prior team security state. Existing provider subscriptions
are not automatically canceled. System cleanup and billing reconciliation remain
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

Apply migrations `0093_platform_admin` and `0094_platform_admin_retention` before
deploying web and worker changes.
Publish the updated Privacy notice and legal version together. Verify the existing
`LEGAL_PUBLICATION_READY` production gate is enabled only after its contracting-entity
readiness requirements are satisfied. This pre-launch revision does not trigger renewed acknowledgment.
The shared platform-admin service owns global directory, session, and audit access;
workspace content continues through `withTeam`. Configure the allowlist on the web
and worker processes so queued impersonated work can verify the administrator.
No production migration or deployment is implied by implementing this feature.

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

## Legal-owner decision — 3 November 2026

The requester approved the retention periods as legal owner in the Codex task
for PR #465 on 3 November 2026, then clarified that the product is not live.
That clarification supersedes the earlier material-update/version-bump decision:

- Session records: 30 days after access ends; audit records: 12 months, subject to
  documented legal holds. Released hold documentation follows the 12-month audit
  accountability period.
- Treat the staff-access and retention disclosures as a pre-launch policy revision.
  Keep Privacy version `2026-11-01` and its effective date unchanged; this change
  does not require renewed acknowledgment. The normal initial acceptance flow and
  future version-change gates remain in place.
- Keep the Terms version `2026-08-21` unchanged: no Terms text or contractual
  grounds for access or suspension change. Existing confidentiality, permitted
  support access, and suspension clauses continue to apply.
- Clarify Trust's distinction between customer team administrators and authorized
  Timeline personnel. Update Trust and Cookies review dates to 3 November 2026.
  There is no new processor or optional analytics purpose and no change to
  optional analytics consent.

This records the requester's legal-owner approval, not an independent counsel
review or a production deployment attestation. Operational access reviews,
customer authorization evidence, emergency review, and the open G-12 controls
remain required.
