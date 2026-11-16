# Document extraction operations

## Snapshots

| Path | When | Command / behavior |
| --- | --- | --- |
| Content-hash name | Always (default) | `timeline-document-extract-<12-char-sha256>` from sandbox dir + serialized image recipe/resources |
| Print name only | Local / CI | `bun run --filter @timeline/worker create-document-extract-snapshot -- --print-name-only` |
| Ensure (idempotent) | Local once, CI on sandbox changes, optional extract boot | `bun run --filter @timeline/worker create-document-extract-snapshot` (alias: `ensure-document-extract-snapshot`) |
| Force rebuild | Corruption / debugging | same script with `--force` |
| CI publish | Push to `production` touching sandbox or snapshot recipe, or manual dispatch | `.github/workflows/publish-document-extract-snapshot.yml` when repo variable `DAYTONA_SNAPSHOT_PUBLISH=true` and secret `DAYTONA_API_KEY` |
| Manual retention | Workflow dispatch / operator maintenance after inspecting all Railway environments | Set `DAYTONA_ACTIVE_SNAPSHOTS` to every deployed hash, then run `bun run --filter @timeline/worker cleanup-document-extract-snapshots -- --retain=3`; missing/stale inventory fails closed |
| Boot ensure | extract-main start | If `DAYTONA_SNAPSHOT_ENSURE=true` (default) and `DAYTONA_API_KEY` set: get-or-create once |

Recommended Railway setting (the worker resolves the hash from the shipped sandbox directory):

```bash
DAYTONA_SNAPSHOT=auto
```

The [sandbox README](../../apps/worker/document-extract-sandbox/README.md) owns creation commands. The [isolation ADR](../adr/0013-daytona-document-extract.md) owns the credential boundary. Preserve deployed snapshot hashes and producer-cleanup tombstones before removing resources.
