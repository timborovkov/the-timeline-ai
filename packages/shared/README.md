# @timeline/shared

Shared workspace policy, persistence services, inference, provider protocols and infrastructure adapters. Applications consume exported subpaths rather than reaching into `src`.

## Boundaries

- Workspace access enters through `withTeam(db, teamId, userId)` and its named modules; no app adapter bypasses team or item visibility.
- Model calls use the shared inference layer. Model pins and routing are source-owned in `src/llm/models.ts`.
- Infrastructure clients own pooling, bounded operations and shutdown. A queue consumer must not close a shared request connection.
- Domain contracts stay dependency-light; transport and orchestration depend on them, not the reverse.

[Domain ownership](../../docs/architecture/ownership.md) maps the implementation seams. [The memory engine](../../docs/relational-memory.md) owns processing/authority; [security](../../docs/security-privacy-trust.md) owns data handling.

## Development

Use `bun run --filter @timeline/shared build` for compiled output and the root test runner for selected suites. Export/loader changes require `bun run test:dist-imports`; agent or reconciliation changes use the corresponding [test gates](../../docs/testing/README.md).

Qdrant operations accept an abort signal and deadline context through the shared wrapper. Distinguish unavailable/partial retrieval from an empty result; never convert infrastructure failure into evidence that no matching content exists.
