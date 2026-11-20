# Synthetic active-store erasure rehearsal · 19 November 2026

The rehearsal used a disposable PostgreSQL database, a versioned RustFS export
bucket, a dedicated Qdrant collection, and scoped Redis and BullMQ fixtures. It
ran the application lifecycle processor with its default storage, vector and
queue handlers. The fixture carried an authorized test actor and advanced the
synthetic clock past the 24-hour late-producer window.

After the processor reached `complete`, the workspace tombstone had a deletion
timestamp. The export row, both object versions, vector point, Redis cache key,
and delayed export job were absent. The fixture checked that each existed
before starting deletion.

The scope was one synthetic workspace and the active stores it used. Backup
expiry and restore, production ingress, processor copies and legal retention
remain tracked separately. [Security gaps](../security-gaps.md)

Reproduce using the [Playwright erasure rehearsal](../../e2e/security-erasure.spec.ts)
with `E2E_REAL_ERASURE=1`, a disposable `DATABASE_URL` and `QDRANT_COLLECTION`,
the local audio and attachment buckets, and a versioning-enabled
`S3_BUCKET_EXPORTS` in the disposable RustFS service.
