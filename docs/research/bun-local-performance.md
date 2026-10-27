# Local Node/Bun performance comparison

Measured on 27 October 2026. These are exploratory local measurements, not staging acceptance evidence. Raw results and methodology are in [bun-local-performance.json](bun-local-performance.json).

The same Bun-built production Next.js artifact and dependency tree ran under Node 24.22.1 and Bun 1.4.4. Each runtime used a fresh process for each of three runs, alternating order (Node/Bun, Bun/Node, Node/Bun). Application requests used synthetic fixtures and an authenticated test user. No live AI or analytics provider was called.

## HTTP results

Four concurrent requests; 5,000 database-health requests and 300 requests each for sign-in and authenticated timeline rendering. Each route received 20 warm-up requests. Values below are medians of three runs; changes are ratios of those medians.

| Metric | Node | Bun | Change |
| --- | ---: | ---: | ---: |
| Health p95, initial warm-up | 13.7 ms | 19.7 ms | +43.8% |
| Sign-in p95 | 153.8 ms | 148.3 ms | -3.6% |
| Timeline p95 | 275.8 ms | 132.0 ms | -52.1% |
| Health p95, longer warm-up | 16.4 ms | 13.6 ms | -16.8% |
| Timeline RSS during load | 867.0 MiB | 532.7 MiB | -38.6% |

The initial health-check tail-latency regression did not persist after adding 1,000 warm-up health requests per process and repeating three pairs. Initial health p95 ranges were 11.6–31.2 ms (Node) and 15.0–28.6 ms (Bun); longer-warm-up ranges were 13.9–26.6 ms and 13.6–15.3 ms respectively. Timeline p95 ranges were 212–741 ms (Node) and 115–161 ms (Bun). These wide ranges limit any precise speedup claim.

CPU is also workload-dependent: for the same request counts, Bun used 20% more median CPU time for sign-in and 29% less for timeline rendering. Longer-warm-up health CPU time was approximately equal. Bun used less RSS in every matched web pair. These short-window RSS samples are not a long-term steady-state or leak test.

## Queue and processing results

Each fresh process warmed up with 1,000 jobs, then processed 20,000 jobs at concurrency four using real local Redis/BullMQ. Each job chunks the same synthetic 31,800-byte document, hashes chunks with SHA-256, and serializes metadata. Outputs had identical checksums across runtimes. The producer and worker share the measured process, so throughput and CPU include enqueue overhead. This excludes database retrieval, AI providers, storage downloads and the rest of the real worker pipeline.

| Metric | Node | Bun | Change |
| --- | ---: | ---: | ---: |
| Queue throughput | 1,804.6 jobs/s | 2,421.5 jobs/s | +34.2% |
| Peak RSS | 220.4 MiB | 124.9 MiB | -43.3% |
| CPU per 20,000 jobs | 7,308.7 ms | 7,412.6 ms | +1.4% |
| Processor-only p95 | 0.200 ms | 0.272 ms | +36.2% |

Queue throughput varied substantially: Bun was approximately 10% faster, 41% faster and 3% slower in the three matched pairs. The ratio of overall medians should not be read as a guaranteed gain.

A separate three-pair, 100,000-iteration CPU comparison isolated the processing steps. Bun took about 74% longer for chunking (roughly 3.7 versus 2.1 microseconds per document), 5% less time for hashing and 45% less for JSON serialization. This does not fully explain the higher per-job tail latency; scheduling and collection effects remain possible contributors, not established causes.

## Decision and remaining gates

The clearest local benefit is lower memory use. Timeline rendering also looks promising, while CPU and tail latency depend on the workload. A shared host showed 10.2% CPU steal in a contemporaneous sample, and the load generator ran on the same machine. Do not use these numbers as production capacity estimates.

Require the planned three matched staging workloads, actual worker job-duration measurements, and 24-hour soak before release acceptance. Investigate any repeatable staging degradation above 10%. Production deployment remains separately authorized.
