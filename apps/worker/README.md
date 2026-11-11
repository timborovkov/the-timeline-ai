# @timeline/worker

BullMQ consumers and background processing. The web service accepts requests; workers perform durable, retryable capture, extraction, indexing and delivery.

## Running

Follow [local setup](../../docs/setup/local.md). Root `bun run dev` starts the ordinary worker with the web app. Dedicated extraction uses `WORKER_MODE=document-extract` and the checked-in extraction Railway configuration; it must receive only the credentials required by that mode.

## Ownership

Queue registrations and worker startup/shutdown live in source, not in a duplicated prose inventory. Preserve startup admission, idempotent job identity, durable retries and cleanup. Drain consumers before closing producers or Redis roles. Workspace operations use `withTeam`; provider adapters must not persist through unscoped connections.

[Domain ownership](../../docs/architecture/ownership.md) maps transaction and lifecycle boundaries. [Extraction operations](../../docs/runbooks/document-extract.md) owns sandbox snapshots. [Job recovery](../../docs/runbooks/job-recovery.md) owns reconciliation. [Integration setup](../../docs/setup/integrations.md) owns provider configuration.

## Verification

Use the nearest worker/domain suites under [testing policy](../../docs/testing/README.md). Offline fixtures never use production services. Live provider calls require the documented isolated fixtures and evidence. Deployment configuration is in [Railway](../../docs/railway.md).

The `website-scan` worker follows the [website scan lifecycle](../../docs/architecture/website-scan.md); [Railway](../../docs/railway.md#environment-variables) owns its service configuration.
