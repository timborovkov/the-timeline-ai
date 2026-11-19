# Isolated architecture verification, 19 November 2026

## Recovery rehearsal

The synthetic restore drill used disposable loopback-only source and target stores. It applied application migrations, restored the PostgreSQL dump and verified the event, document version, and membership relationships. It restored four object keys and five logical versions across audio, attachments, documents, and exports, with matching SHA-256 values. Team-scoped search returned the expected restored event while excluding another team's point.

| Metric | Target | Observed |
| --- | --- | --- |
| Time to verified recovery | 4 hours | 17.86 seconds, including target store startup |
| Age of common recovery point at incident start | 24 hours | 1.038 seconds |
| Writes outside the selected recovery point | Measured | One known post-backup PostgreSQL fixture write |

The drill used `postgres:18-alpine`, `qdrant/qdrant:v1.20.0`, and `rustfs/rustfs:1.0.3@sha256:9ca9559533b537d10482fe923288b676ad08f92a7069d9a17327fbae3cab688b`. These timings cover synthetic data on one machine. Production backup cadence, collection size, and recovery time require separate verification.
