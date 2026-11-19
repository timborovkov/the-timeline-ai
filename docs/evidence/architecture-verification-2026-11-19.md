# Isolated architecture verification, 19 November 2026

## Recovery rehearsal

The synthetic restore drill used disposable loopback-only source and target stores. It applied application migrations, restored the PostgreSQL dump and verified the event, document version, and membership relationships. It restored four object keys and five logical versions across audio, attachments, documents, and exports, with matching SHA-256 values. Team-scoped search returned the expected restored event while excluding another team's point.

| Metric | Target | Observed |
| --- | --- | --- |
| Time to verified recovery | 4 hours | 17.86 seconds, including target store startup |
| Age of common recovery point at incident start | 24 hours | 1.038 seconds |
| Writes outside the selected recovery point | Measured | One known post-backup PostgreSQL fixture write |

The drill used `postgres:18-alpine`, `qdrant/qdrant:v1.20.0`, and `rustfs/rustfs:1.0.3@sha256:9ca9559533b537d10482fe923288b676ad08f92a7069d9a17327fbae3cab688b`. These timings cover synthetic data on one machine. Production backup cadence, collection size, and recovery time require separate verification.

## Homepage and streaming

System Chromium 154 made three cold loads at each viewport on local production builds. The baseline was `c4957031`, the checkout used to investigate the original payload. The candidate included the later development base. JavaScript sizes are medians before scrolling. Markup counts exclude embedded React Flight scripts.

| Measurement | Baseline | Candidate |
| --- | ---: | ---: |
| Uncompressed HTML, bytes | 816,166 | 238,590 |
| Embedded React Flight scripts, bytes | 437,020 | 133,328 |
| Remaining markup and inline data, bytes | 379,146 | 105,262 |
| Desktop JavaScript transferred, bytes | 381,331 | 325,909 |
| Desktop JavaScript decoded, bytes | 1,176,972 | 1,014,605 |
| Mobile JavaScript transferred, bytes | 405,179 | 327,535 |
| Mobile JavaScript decoded, bytes | 1,242,974 | 1,017,295 |
| First proof screenshot at 1440 CSS pixels and DPR 1 | 2,880 px | 828 px |
| First proof screenshot at 390 CSS pixels and DPR 2 | 2,880 px | 750 px |

Both screenshot themes loaded at the measured sizes. Desktop transferred a median of 24 JavaScript chunks and mobile transferred 25. No browser errors were observed during the profile.

An authenticated browser used Capture and triggered Ask validation during PostgreSQL locks on the digest and document-version tables. Recent Activity appeared after the locks released. The disposable reverse proxy served a homepage cache hit with identical HTML and zero cookies for a signed-in request. The session endpoint remained private.

The isolated processing probe returned healthy with a one-hour-old ordinary chunked upload. Adding a stale capture triggered the capture and index alerts while all eight enabled readiness consumers still reported available.
