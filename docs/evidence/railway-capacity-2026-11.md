# Railway capacity observations

Historical measurements recorded in the November 2026 deployment guide. They are starting evidence, not the current deployed limits or a capacity guarantee. Re-measure before changing limits or bulk maintenance.

### CPU and memory caps

Production limits verified on 2026-10-24, per replica. The seven-day metrics query used 60-second samples; the current deployments had only been running since October 23–24, so this is a limited operating history. Sampled peaks can miss shorter bursts. These initial caps leave headroom above observed operation and should be reviewed after larger imports, concurrent jobs, or traffic increases.

| Service                       | CPU cap | RAM cap | Sampled RAM peak                 |
|-------------------------------|---------|---------|----------------------------------|
| Web                           | 2 vCPU  | 2 GB    | 0.63 GB                          |
| Worker                        | 2 vCPU  | 2 GB    | 0.61 GB                          |
| Document extract orchestrator | 2 vCPU  | 2 GB    | 0.65 GB                          |
| Postgres                      | 2 vCPU  | 2 GB    | 0.55 GB                          |
| Qdrant                        | 2 vCPU  | 3 GB    | 2.27 GB after restart and probes |
| RustFS                        | 1 vCPU  | 1 GB    | 0.30 GB                          |
| Redis                         | 1 vCPU  | 0.5 GB  | 0.033 GB                         |

Set both limits in Railway's service settings or with the resource-limits API. Limits apply to the running deployment without rebuilding it. CPU contention can throttle work; exceeding the memory limit can terminate the process. Caps bound resource consumption; billing follows actual usage rather than the configured maximum. See [Railway scaling](https://docs.railway.com/deployments/scaling) and [billing](https://docs.railway.com/pricing/understanding-your-bill).

<span id="qdrant-serverless"></span>

### Qdrant memory

On 2026-11-04, the unused `events` rollback collection was removed with operator authorization after a fresh snapshot was downloaded and checksum-verified. Production now contains only `events_ondisk`, verified green with 74,461 points. Recovery of the retired collection requires restoring the local snapshot; the active collection was unchanged. The checksum-verified snapshot is retained in the operator’s local Qdrant backup directory dated 2026-11-04. The measurements below describe the earlier two-collection state.

On 2026-10-24, production Qdrant 1.20.0 held 74,170 points in each of `events_ondisk` (active) and `events` (rollback). Restarting reduced Railway's memory reading from 3.98 GB to 1.42 GB. Search warmed it to 2.00 GB; a temporary 2,048-vector ingestion and indexing probe reached a sampled 2.24 GB. The probe used 32 real embeddings with synthetic variations, forced indexing only in its temporary collection, and verified deletion of every probe point and the collection afterward. These are bounded smoke tests, not a full production reindex or sustained-load capacity benchmark.

After searches, collection memory estimates showed about 119 MB of pinned RAM and 474 MB of file cache for the active collection, plus 600 MB of file cache for the rollback collection. Allocator resident memory was about 284 MB after search and peaked near 512 MB during the probe; allocator and collection figures overlap and must not be added together. The restart and cache warming support retained filesystem cache as the main explanation for high idle usage, but kernel-level accounting was unavailable, so the original 3.98 GB was not fully attributed. Qdrant's collection memory endpoint excludes some runtime and filesystem overhead; see [Qdrant memory usage](https://qdrant.tech/documentation/ops-monitoring/memory-usage/).

The initial production limits are 2 vCPU and 3 GB RAM, reduced from 24 vCPU and 24 GB. The seven-day query also contained a pre-restart 18.98 GB sample; the normal-operation cap does not establish capacity for that historical workload. Plan temporary headroom and retest before full reindexing, collection copies, snapshots, or increasing ingestion concurrency. The unused rollback collection was removed on 2026-11-04 after a verified snapshot. Before considering a smaller limit, repeat the measurements on the remaining active collection. A memory limit bounds consumption; it does not reserve or bill its full value while unused.

Watch volume sizing — Railway storage is more expensive than the compute. For prod beyond a few teams, consider moving RustFS data to a cheaper external S3-compatible store (Backblaze B2, Cloudflare R2) and using RustFS only as a self-host fallback or dev convenience.
