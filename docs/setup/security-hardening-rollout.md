# Security hardening rollout

## Invitation migration

Pause invitation traffic and stop old notification and billing consumers before
any web or worker service can apply `0109_invite_token_digests`. The journal
applies `0109_first_run_connector_paths` first, then
`0109_invite_token_digests`, then `0110_legal_acceptance_content_hashes`.
Railway pre-deploy hooks for those services can apply migrations before routing
switches.
The migration replaces the old token column values in place. Cut over to updated
web and workers together, then verify a previously issued synthetic invitation,
a newly generated link and revocation before reopening invite traffic. A web
rollback alone would break invite reads and writes. Keep a forward fix available
and handle any database restore through the approved backup runbook.

The migration hashes legacy delivery and metering keys. Legacy Polar attempts
with status `reconciliation_required` need billing-owner review. Match them by
workspace, timestamp, event type, units and charge to the provider's event history
before authorizing any replacement. An earlier attempt may already have been
accepted. Review historical provider and ingress copies for retained live links,
and rotate affected invitations through the normal resend or revocation flow.

## Ingress and browser policy

The application rejects chat bodies over 4 MiB and global search bodies over
16 KiB. The Next.js proxy rejects matching declared lengths for signed-in
sessions. The route reader independently enforces the byte cap on streams. Next.js
also has a shared 10 MiB internal proxy buffer. Verify any earlier rejection
limits at the trusted ingress with synthetic fixtures, including requests whose
length is unknown before streaming. Record the edge configuration and status
responses. Check that credential paths, query strings and redirect locations are
redacted or excluded in Railway and any upstream proxy or HTTP log exporter.

Web production starts with the expanded Content Security Policy in report-only
mode. Capture directive names from Chromium using synthetic signup and Turnstile
fixtures, public analytics opt-in, OAuth, chats, document upload, and signed PDF
previews. Keep raw URLs and report payloads out of the evidence record. Repeat
this check through the staging hostname and its browser-facing storage origin.
After those flows pass, set `WEB_CSP_MODE=enforce` on that web service and repeat
the checks. Remove the setting and restart the service to restore report-only.
The initial policy allows inline scripts and styles for static Next.js pages.
The configured storage origin is allowed for document preview embeds.

## Dated closure evidence

Record the environment, scope, named owner and verification date in the
internal control file. Store redacted references to evidence. The
[gap register](../security-gaps.md) tracks closure.

| Control | Evidence to retain |
| --- | --- |
| G-09 · Credential email tracking | Disable open and click tracking on the transactional Resend domain. Capture the domain setting and redacted delivered verification, invitation and recovery messages showing direct links and absence of tracking pixels. Review retained historical tracking data with the privacy owner. |
| G-11 · Monitoring | Inspect representative scrubbed error events and spans for verification, invites, calendar feeds and OAuth callbacks. Record project access and retention settings. |
| G-12 · Staff access | Inventory named Railway, data store, GitHub and provider accounts. Verify required MFA and least privilege, document emergency access and retain the latest access review. |
| G-13 · Erasure | Rehearse with synthetic data using the [manual deletion procedure](manual-support-deletion.md), distinguishing active systems, backups and justified retention. Record restore and re-delete behavior for backups, processor receipts, and unresolved service-specific limitations. |
| G-19 · Legal acceptance | Record legal approval and verify the archived Terms and Privacy digests against the published release and a synthetic acceptance. Preserve each prior version and its digest. |
