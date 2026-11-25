# Operations

Use the specific runbook before changing infrastructure or retained data. Production access and destructive actions require the task's authorization; a procedure is not proof that the operation has been completed.

| Task | Owner |
| --- | --- |
| Provision, deploy, rollback, resource sizing | [Railway](railway.md) |
| Queue readiness, missing jobs, retries | [Job recovery](runbooks/job-recovery.md) |
| Isolated PostgreSQL, object, and vector recovery | [Restore runbook](runbooks/restore.md) |
| Re-extract, re-embed, vector collection migration | [Vector maintenance](runbooks/reindex.md) |
| Document extraction snapshots | [Extraction operations](runbooks/document-extract.md) |
| Email delivery/capture and replay | [Resend](setup/resend.md) |
| Member billing conversion, webhook delays, reconciliation | [Polar](setup/polar.md) |
| Privileged support access | [Platform administration](platform-admin.md) |
| Erasure request | [Manual support deletion](setup/manual-support-deletion.md) |
| PostgreSQL major-version upgrade | [Local upgrade](setup/postgres18.md); production requires its own rehearsed plan |
| Exceptional Drive/coworker migration lineage | [Migration ordering](migrations/coworker-drive-order.md) |

## Health

Use public `/api/health` to check web and database liveness. Use `GET /api/health/ready` to check for the expected BullMQ consumers. These operator endpoints require `Authorization: Bearer <CRON_SECRET>` and return uncached aggregate status. Set `DOCUMENT_EXTRACT_ENABLED` on the web service to reflect whether the deployment expects an extraction consumer.

Schedule `POST /api/health/operations` every five minutes from an external scheduler. A 200 means no threshold has fired, a 503 means at least one threshold fired or the probe failed. Alert when the scheduler misses a run, since the endpoint itself cannot report an outage. The operational endpoint checks:

| Signal | Trigger |
| --- | --- |
| Capture latency | In the last day, any eligible capture over 30 minutes without its index receipt, or the completed capture-to-index p95 reaches 30 minutes. |
| Document extraction | A finalized upload over 30 minutes in pending or extracting state, a stalled extraction queue, or five recent failures. |
| Proposal jobs | Suggestions or reconciliation jobs waiting or running for 30 minutes, or five terminal failures in the last day. |
| Missed digests | The five-minute personal update tick is more than 20 minutes behind, the shared digest tick has missed its 13:00 UTC grace period, a delivery stays pending for an hour, or five recent deliveries or queue jobs fail. |
| Integration sync and webhook delivery | Waiting or running for 30 minutes, or five terminal failures in the last day. |
| Index freshness | Eligible text events or chunked website pages are 30 minutes behind, embed jobs stall or accumulate failures, or Qdrant collection metadata is unavailable. |

The queue probes sample the oldest waiting item and up to 100 active and recent failed jobs per queue. Metrics use database ingest timestamps and completed writes from the last 24 hours. The endpoint emits a Sentry issue per alert condition at most once an hour across replicas. Configure notifications for the `processing_health` operation in [Sentry](setup/sentry.md#alerts), independently of liveness and readiness. Keep the bearer in the scheduler's secret store.

At release, verify the public HTML cache with and without an Auth.js session cookie. A cacheable public response should have no `Set-Cookie` and should serve the same HTML on a hit. Keep session API responses private and preserve Next.js response variants when configuring the edge cache.

For failed delivery, inspect sanitized message-delivery records and provider diagnostics; do not paste raw payloads, tokens or signed URLs into issues. Auth/password recovery follows the [security contract](security-privacy-trust.md#password-recovery); email configuration belongs to Resend setup.

## Recurring responsibilities

Assign an operator and record outcomes outside the live instructions:

- Verify backup freshness weekly and rehearse an isolated restore quarterly. Include PostgreSQL, source bytes, vectors and the documented recovery ordering.
- Review CPU/RAM, storage, queue age, integration failures and provider spend against current load. Re-measure before lowering limits, reindexing or copying collections.
- Review/rotate credentials and access quarterly, using provider-specific cutover and rollback procedures; avoid interrupting encryption-key access to retained data.
- Exercise re-extraction/re-embedding periodically and compare eligible source rows with indexed payloads by team and content kind.
- Review Docker/Railway configuration against actual deployments. Preserve a dated observation rather than writing a live branch name into the setup guide.
- Apply isolation/privacy review on schema, ingest, MCP, permissions and data-access changes. Track unmet controls only in [security gaps](security-gaps.md).
