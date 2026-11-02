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
Security state remains separate from billing; restoration preserves other billing
restrictions and the prior team security state. Existing provider subscriptions
are not automatically canceled. System cleanup and billing reconciliation remain
available. The panel cannot suspend the operator or another allowlisted admin.

Suspended accounts and teams allow read-only impersonation inspection. The
request, scoped operation, database-write, and job-admission boundaries block
mutations and new work. Previously issued external signed URLs retain their
existing expiry; suspension does not revoke a provider URL already issued.

Platform audit history is append-only and records management changes, support
session lifecycle, request attempts, scoped operations, and attributed job
execution. It records real and effective actor identifiers without copying
customer content, credentials, or request query strings into audit metadata.
An expired session is recorded when subsequently resolved; expiry is enforced by
time comparison even if no later request arrives.

## Implementation and rollout

Apply migration `0093_platform_admin` before deploying web and worker changes.
The shared platform-admin service owns global directory, session, and audit access;
workspace content continues through `withTeam`. Configure the allowlist on the web
and worker processes so queued impersonated work can verify the administrator.
No production migration or deployment is implied by implementing this feature.
