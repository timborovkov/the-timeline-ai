# Operations

Use the specific runbook before changing infrastructure or retained data. Production access and destructive actions require the task's authorization; a procedure is not proof that the operation has been completed.

| Task | Owner |
| --- | --- |
| Provision, deploy, rollback, resource sizing | [Railway](railway.md) |
| Queue readiness, missing jobs, retries | [Job recovery](runbooks/job-recovery.md) |
| Re-extract, re-embed, vector collection migration | [Vector maintenance](runbooks/reindex.md) |
| Document extraction snapshots | [Extraction operations](runbooks/document-extract.md) |
| Email delivery/capture and replay | [Resend](setup/resend.md) |
| Member billing conversion, webhook delays, reconciliation | [Polar](setup/polar.md) |
| Privileged support access | [Platform administration](platform-admin.md) |
| Erasure request | [Manual support deletion](setup/manual-support-deletion.md) |
| PostgreSQL major-version upgrade | [Local upgrade](setup/postgres18.md); production requires its own rehearsed plan |
| Exceptional Drive/coworker migration lineage | [Migration ordering](migrations/coworker-drive-order.md) |

## Health

`/api/health` is public liveness. `/api/health/ready` requires `Authorization: Bearer <CRON_SECRET>`, returns no-store aggregate readiness, and checks worker presence/queue age with bounded probes. It does not establish answer quality, every queue's progress or invoice correctness. Never place the secret in a URL.

For failed delivery, inspect sanitized message-delivery records and provider diagnostics; do not paste raw payloads, tokens or signed URLs into issues. Auth/password recovery follows the [security contract](security-privacy-trust.md#password-recovery); email configuration belongs to Resend setup.

## Recurring responsibilities

Assign an operator and record outcomes outside the live instructions:

- Verify backup freshness weekly and rehearse an isolated restore quarterly. Include PostgreSQL, source bytes, vectors and the documented recovery ordering.
- Review CPU/RAM, storage, queue age, integration failures and provider spend against current load. Re-measure before lowering limits, reindexing or copying collections.
- Review/rotate credentials and access quarterly, using provider-specific cutover and rollback procedures; avoid interrupting encryption-key access to retained data.
- Exercise re-extraction/re-embedding periodically and compare eligible source rows with indexed payloads by team and content kind.
- Review Docker/Railway configuration against actual deployments. Preserve a dated observation rather than writing a live branch name into the setup guide.
- Apply isolation/privacy review on schema, ingest, MCP, permissions and data-access changes. Track unmet controls only in [security gaps](security-gaps.md).
