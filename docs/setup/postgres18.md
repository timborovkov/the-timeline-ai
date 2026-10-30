# Local PostgreSQL 16 → 18 migration

This procedure is for the default **local Docker Compose** stack. It does not
upgrade Railway. Production needs a separately rehearsed migration, backup,
write freeze, validation, and cutover plan.

PostgreSQL 18 stores its cluster at `/var/lib/postgresql/18/docker`; Compose now
mounts the parent `/var/lib/postgresql`. The default logical volume remains
`postgres_data`, so an existing PostgreSQL 16 cluster is detected and startup
fails closed. **Do not delete that volume, move its files into an 18 directory,
or run `docker compose down -v`.** PostgreSQL major versions cannot share a
cluster's on-disk files.

A fresh checkout with an empty volume needs no migration: use the normal setup
instructions. For an existing database, dump/restore into the separate
`postgres18_data` volume. Changing `POSTGRES_DATA_VOLUME` alone creates an empty
database; it is not a migration.

## 1. Freeze writes and identify the source

Rehearse these steps on a copy first if the data is irreplaceable. Stop host-run
`bun run dev`, workers, scheduled scripts, and any other database clients.
Pause external intake or ensure incoming events are durably queued for replay.
Keep them stopped through validation. In the repository root:

```bash
docker compose stop web worker postgres
docker volume ls --filter label=com.docker.compose.volume=postgres_data
```

Identify the volume belonging to this checkout's Compose project. The default
project is `timeline`, giving `timeline_postgres_data`. Custom project names
produce different names; **substitute the actual source volume below**. Do not
guess or select a volume belonging to another project.

```bash
source_volume=timeline_postgres_data
docker volume inspect "$source_volume"
docker run --rm --network none \
  --mount "type=volume,src=$source_volume,dst=/source,readonly" \
  --entrypoint sh postgres:16-alpine \
  -ec 'test "$(cat /source/PG_VERSION)" = 16'
```

Both commands must succeed. Ensure no running container is using that volume.
If the version is not 16, stop and use the appropriate upgrade procedure.
Never run two PostgreSQL servers against the same volume.

## 2. Start only the old database and back it up

This temporary container has no network and exposes no port. It can read the
old layout even if the new Compose service has already refused to start.
Leave its default database settings intact; this runbook assumes the original
`timeline` owner and database. A modified installation needs its own role,
database, extension, tablespace, and permissions inventory before proceeding.

```bash
docker run -d --name timeline-pg16-migration --network none \
  --mount "type=volume,src=$source_volume,dst=/var/lib/postgresql/data" \
  postgres:16-alpine
docker exec timeline-pg16-migration pg_isready -h 127.0.0.1 -U timeline -d timeline
```

Repeat the readiness check until successful. Review active sessions and confirm
there are no application writers. Check for additional databases or roles:

```bash
docker exec timeline-pg16-migration psql -X -U timeline -d timeline -c \
  "SELECT datname FROM pg_database WHERE NOT datistemplate;"
docker exec timeline-pg16-migration psql -X -U timeline -d timeline -c \
  "SELECT rolname FROM pg_roles WHERE rolname !~ '^pg_' ORDER BY rolname;"
docker exec timeline-pg16-migration psql -X -U timeline -d timeline -c \
  "SELECT extname, extversion FROM pg_extension ORDER BY extname;"
```

The default has databases `postgres` and `timeline`, role `timeline`, and
extension `plpgsql`. If you added data to `postgres`, extra databases, roles,
permissions, tablespaces, or extensions, stop and extend the backup/restore plan
to cover them. The commands below restore the application database using its
single default owner, without restoring custom grants.

Create a private backup directory **outside the repository**. Run the following
in Bash; `set -e` prevents continuing after a failed dump:

```bash
set -e
umask 077
backup_dir=$(mktemp -d "$HOME/timeline-pg16-backup.XXXXXX")
docker exec timeline-pg16-migration pg_dump -U timeline -d timeline \
  --format=custom > "$backup_dir/timeline.dump"
docker exec timeline-pg16-migration pg_dumpall -U timeline \
  --globals-only > "$backup_dir/globals.sql"
test -s "$backup_dir/timeline.dump"
sha256sum "$backup_dir/timeline.dump" > "$backup_dir/timeline.dump.sha256"
docker stop timeline-pg16-migration
```

Retain a protected second copy of this directory outside the Docker host. The
original volume and the stopped temporary container remain available. A dump
is only proven usable after a successful restore and comparison.

## 3. Restore into a fresh PostgreSQL 18 volume

Verify the target volume does not already contain data. For the default project
its name is `timeline_postgres18_data`. If it already exists, inspect it and
stop; do not overwrite it or resume a partial restore blindly.

```bash
docker volume ls --filter label=com.docker.compose.volume=postgres18_data
export POSTGRES_DATA_VOLUME=postgres18_data
docker compose up -d --no-deps postgres
docker compose exec -T postgres pg_isready -h 127.0.0.1 -U timeline -d timeline
```

Wait for readiness. Do not start the app, seed, or run application migrations
before restoring into this empty database:

```bash
docker compose exec -T postgres pg_restore -U timeline -d timeline \
  --exit-on-error --single-transaction --no-owner --no-acl \
  < "$backup_dir/timeline.dump"
docker compose exec -T postgres psql -X -v ON_ERROR_STOP=1 -U timeline -d timeline \
  -c 'ANALYZE;' -c 'SHOW server_version;' -c 'SHOW data_directory;'
```

Expect version 18 and `/var/lib/postgresql/18/docker`. A restore error blocks
cutover. Do not skip errors or run against a populated target.

## 4. Validate before reopening writes

Keep the app and workers stopped. You can restart `timeline-pg16-migration`
(still network-isolated) to compare source and destination through `docker exec`.
Confirm exact row counts for **every application table**, schema/constraints,
sequences, extension availability, and the application's migration history.
Counts alone do not prove identical contents: compare full ordered exports or
content checksums for critical tables, and test representative reads and
permissions. Investigate every discrepancy before proceeding.

Recreate the destination container and confirm the restored data persists:

```bash
docker compose up -d --no-deps --force-recreate postgres
docker compose exec -T postgres pg_isready -h 127.0.0.1 -U timeline -d timeline
```

After successful validation, change the existing `.env` entry to
`POSTGRES_DATA_VOLUME=postgres18_data` (add it if missing). Ensure future shells
and Compose invocations use that same value: an exported variable overrides
`.env`. Keep the existing `DATABASE_URL`, credentials, and other service volumes.
Apply any outstanding application migrations with `bun run db:migrate` using
the normal explicit environment-loading instructions, then start the app and
workers and resume intake. Verify local application reads and writes.

Keep the old volume and backups until the upgrade is verified and the new
database has its own tested backups. Never use `down -v` as migration cleanup:
it can remove both database volumes and other service data.

## Rollback boundary

Before PostgreSQL 18 accepts application writes, stop the 18 service and use
PostgreSQL 16 with the retained source volume mounted at
`/var/lib/postgresql/data`. A local Compose rollback must restore both the
`postgres:16-alpine` image **and** the old mount target, and select
`POSTGRES_DATA_VOLUME=postgres_data`; stop the temporary 16 container before
starting that service. Do not use the new parent mount with the 16 image.

After PostgreSQL 18 accepts writes, switching back to the old volume would lose
those new writes. Freeze writes and reconcile/export them before any rollback.
Retaining the old volume alone does not make post-cutover rollback lossless.
