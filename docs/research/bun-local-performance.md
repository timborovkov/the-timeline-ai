# Local Node/Bun performance comparison

The latest review measurements are from 28 October 2026. They show lower memory use and faster
dependency installation with Bun, but do not establish a general latency or worker-throughput
improvement. These are local synthetic measurements, not staging acceptance. The
[review samples and commands](bun-local-performance-review.json) and
[original 27 October samples](bun-local-performance.json) remain available.

## Method

Node 24.22.1 and Bun 1.4.4 ran the same Bun-built production Next.js artifact and dependency tree.
Each comparison used three fresh-process pairs, alternating Node/Bun, Bun/Node, Node/Bun. The host
had a four-CPU quota and approximately 18 GiB of RAM; sampled CPU steal was 6–8%. The load generator
ran on the same host. No builds or test suites ran alongside the runtime measurements.

HTTP requests used isolated synthetic fixtures and authenticated fixture cookies. No live AI or
analytics provider was called. Each measured route used concurrency four: 5,000 health requests, 300
sign-in requests, and 300 authenticated timeline requests. The initial comparison warmed each route
with 20 requests. A separate three-pair comparison used 200 warm-up requests per route. Do not
combine samples from these two methods.

The portable [harness and reproduction instructions](../../scripts/performance/README.md) require
explicit runtime binaries and synthetic authentication inputs. The harness does not read
live-service environment files.

## Web results

Values are medians of three runs. Changes are ratios of those medians, which can differ from the
median of paired percentage changes.

| Metric                                        |       Node |        Bun | Change |
| --------------------------------------------- | ---------: | ---------: | -----: |
| Health p95, 20-request warm-up                |   11.64 ms |   11.66 ms |  +0.2% |
| Sign-in p95, 20-request warm-up               |   96.02 ms |  111.75 ms | +16.4% |
| Timeline p95, 20-request warm-up              |  320.98 ms |  441.44 ms | +37.5% |
| Health p95, 200-request warm-up               |   11.20 ms |   10.09 ms |  -9.9% |
| Sign-in p95, 200-request warm-up              |   92.52 ms |  101.62 ms |  +9.8% |
| Timeline p95, 200-request warm-up             |  305.27 ms |  310.32 ms |  +1.7% |
| Timeline RSS during load, 200-request warm-up | 855.62 MiB | 639.45 MiB | -25.3% |
| Timeline peak RSS, 200-request warm-up        | 898.56 MiB | 680.46 MiB | -24.3% |

The initial timeline regression appeared in all three pairs (+29% to +62%). Longer warm-up changed
that result substantially, but did not eliminate variance: timeline paired p95 changes were -40%,
+59%, and +2%; sign-in changes were -51%, +66%, and +10%. This is evidence of warm-up sensitivity
and unstable local timing, not proof that Bun is faster or that a production regression has been
excluded. The separate longer-health-warm-up samples are also retained in the raw results.

Bun used less RSS in every matched web pair. With 200 warm-up requests, median RSS during load was
about 25–27% lower across routes. These short-window samples are not a long-term steady-state or
leak test. CPU remained workload-dependent: median CPU for the fixed request counts was 8% lower for
health, 14% lower for sign-in, and 11% higher for timeline rendering in the longer-warm-up
comparison.

Diagnostic CPU profiles exercised both runtimes with the same request sequence. They showed
rendering, Drizzle query construction, module loading, and stream handling among sampled work,
without establishing one cause of the latency variation. The profilers have different
implementations; profiled timings are not included in the benchmark tables. No speculative runtime
or garbage-collector tuning was added to deployment configuration.

## Queue and processing results

Each fresh process warmed with 1,000 jobs, then processed 20,000 jobs at concurrency four using real
local Redis/BullMQ. Each job chunks the same synthetic 31,800-byte document, hashes chunks with
SHA-256, and serializes metadata. All runtime output checksums matched. Producer and worker share
the measured process, so throughput and CPU include enqueue overhead. This excludes database
retrieval, AI providers, storage downloads, and the rest of the real worker pipeline.

| Metric              |           Node |            Bun |             Change |
| ------------------- | -------------: | -------------: | -----------------: |
| Queue throughput    | 2,636.2 jobs/s | 2,538.7 jobs/s |              -3.7% |
| Peak RSS            |      212.8 MiB |      127.5 MiB |             -40.1% |
| CPU per 20,000 jobs |     6,316.2 ms |     6,834.7 ms |              +8.2% |
| Processor-only p95  |       0.199 ms |       0.219 ms | approximately +10% |

Bun throughput was 12.9%, 11.4%, and 0.3% lower in the matched pairs. The 3.7% ratio of medians
therefore does not demonstrate throughput parity on its own. A separate three-pair,
100,000-iteration comparison found chunking CPU about 133% higher under Bun (approximately 3.5
versus 1.5 microseconds per document), hashing CPU about 5% higher, and JSON serialization CPU about
53% lower. This isolates one processing tradeoff but does not explain the whole queue or web result.

## Installation, build, and tests

These are separate, single observations from clean workspace layouts using the existing package
download caches. They are not cold-network install measurements. The Node checkout used the original
`276a6f00` source and pnpm 11.8.0; the Bun checkout used the migration candidate. Both frozen
installs passed. Both full workspace builds forced execution with concurrency one and no prior
`dist`, `.next`, or Turbo artifacts.

| Command group                                | Node/pnpm |      Bun |
| -------------------------------------------- | --------: | -------: |
| Frozen install, existing download caches     |   46.22 s |   4.18 s |
| Forced full workspace build, concurrency one |  290.40 s | 280.40 s |

The canonical Bun offline suite passed all 620 files in one uninterrupted 71.1-minute run, reporting
5,140 passing cases and two existing inline live-provider skips. Six dedicated live files were
excluded under their original opt-in rules. The original Node suite stopped at an existing 10-second
database-setup timeout; there is no valid full-suite test-speed comparison.

## Release interpretation

The reliable local benefits are lower memory use and faster installation in the measured cache
conditions. The original 27 October runs showed larger latency and queue-throughput gains that this
review did not consistently reproduce. Do not use either set as a production capacity estimate or
claim a universal speedup.

Before release acceptance, run three matched staging workloads with identical fixtures and resource
limits, including cold and warmed web traffic and actual worker job durations. Investigate
repeatable degradation above 10% in latency, throughput, or memory. Complete the 24-hour soak
covering scheduled work, reconnects, restarts, and memory growth. These gates remain open;
production deployment requires separate authorization.
