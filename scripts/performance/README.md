# Local runtime comparison

These harnesses preserve the workloads used in
[the local migration measurements](../../docs/research/bun-local-performance.md). They compare the
same compiled application/dependencies under an explicitly selected Node baseline and Bun. They do
not measure a historical Node build or replace staging acceptance. Node is used only as a benchmark
baseline.

Requirements: Linux `/proc`, Python 3, the pinned Bun, an explicit Node binary, compiled
database/shared packages, and disposable local Redis on port 6379. The harness verifies the pinned
Bun version and rejects Bun-backed `node` aliases as the Node baseline. Queue measurements use
unique queues in database 15 and remove only those queues. Do not run other builds or tests
concurrently with measurements.

```sh
bun run --filter @timeline/db build
bun run --filter @timeline/shared build
python3 scripts/performance/compare.py --node /absolute/path/to/node \
  --mode queue --synthetic-fixtures --output /tmp/queue-comparison
python3 scripts/performance/compare.py --node /absolute/path/to/node \
  --mode processing --synthetic-fixtures --output /tmp/processing-comparison
```

For HTTP measurements, build the production web artifact against disposable synthetic fixtures using
`bun run e2e:prod-smoke`. Prepare a JSON file containing only `DATABASE_URL` and `AUTH_SECRET`, plus
Playwright `storageState` for a synthetic fixture user authenticated against that database and
secret. Do not commit these files or use live-service credentials. The harness permits only loopback
database hosts, strips inherited environment variables, disables automatic environment loading, and
runs the standalone server on port 3102. That port must be free.

```sh
python3 scripts/performance/compare.py --node /absolute/path/to/node \
  --fixture /tmp/synthetic-fixture.json --auth-state /tmp/synthetic-auth.json \
  --mode http --synthetic-fixtures --output /tmp/http-comparison
python3 scripts/performance/compare.py --node /absolute/path/to/node \
  --fixture /tmp/synthetic-fixture.json --auth-state /tmp/synthetic-auth.json \
  --mode warm-health --synthetic-fixtures --output /tmp/warm-health-comparison
```

HTTP runs default to 20 warm-up requests per route. Use `--http-warmup-requests=200` for a
separately recorded longer-warm-up follow-up; never mix samples with different warm-up counts.

Each mode alternates three pairs: Node/Bun, Bun/Node, Node/Bun. `all` runs queue, HTTP, and
processing workloads. Output directories must not already exist. `method.json` records runtime
versions and revision; `runtime-performance.json` records raw samples. Server logs remain local.
Compare paired samples and medians, not just the fastest run. Queue throughput includes enqueue
overhead and synthetic chunk/hash/JSON work; processor timing excludes queue waiting and external
services.

Record install, build, and full-suite timings separately from these runtime measurements. A
warm-cache install or incremental build is not a clean baseline. Historical measurements cannot be
reconstructed from a migrated dependency tree.
