# Restore PostgreSQL, raw objects, and vectors

Use a fresh environment with its own network, credentials, and volumes. Keep provider jobs, delivery workers, and public ingress disabled while restoring.

The provisional target is **four hours to verified recovery** and **up to 24 hours of lost writes**, measured from incident start to the latest recoverable point common to the three stores. Record actual results separately. Production targets depend on measured backup cadence, dataset size, and a rehearsal using representative backups.

## Restore order

1. Choose one recovery point. Check the PostgreSQL dump or point-in-time restore timestamp, object version manifest, Qdrant collection snapshot time, image versions, and checksums. Use a consistent cut with writes quiesced, or reconcile store differences before serving traffic. Make the key material needed to decrypt restored integration secrets available through the approved secret store.
2. Restore PostgreSQL into a fresh instance using the matching major version. Verify migrations, membership, access boundaries, and representative raw event and document references.
3. Recreate private, versioned RustFS buckets. Restore raw objects using the original bucket and object keys. Verify bytes against the backup manifest, including historical versions where retained. Check that database references resolve. Storage-generated version IDs may change with logical copies.
4. Recover the Qdrant snapshot in an isolated collection. Verify storage configuration, embedding model and dimensions, and team-scoped retrieval against restored records. If the snapshot is unusable or inconsistent, rebuild from restored sources using [vector maintenance](reindex.md).
5. Verify authenticated timeline reads and file playback or download. Reconcile jobs from durable source state using [job recovery](job-recovery.md). Review pending outbound deliveries before enabling workers or accepting traffic. Record recovery time, oldest common checkpoint, missing or replayed writes, versions, and checks.

## Synthetic rehearsal

Run from the repository root with Docker and the pinned Bun version.

    bun --no-env-file run ops:restore-drill

The command creates unique disposable source and restore stores using the Compose image references and loopback-only service ports. It runs the application migrations, captures a PostgreSQL dump, copies versioned fixture objects, and restores a collection snapshot. It checks database references, SHA-256 bytes in four buckets, and a team-filtered search with a second team's point present. It also verifies a known post-backup write is outside the recovery point. The reported measurements describe the synthetic dataset. See the [19 November 2026 rehearsal](../evidence/architecture-verification-2026-11-19.md) for the initial results.

For Railway, follow the [deployment guide](../railway.md#backups) and record evidence separately from these instructions.
