# @timeline/web

Next.js app for the public site, authenticated workspace, server actions and inbound HTTP endpoints.

## Development

Follow [local setup](../../docs/setup/local.md), then run `bun run dev` from the repository root. The root command starts web and worker with the exported development environment. Read [AGENTS.md](AGENTS.md) before changing framework behavior.

## Ownership

- Routes and transport adapters: `src/app`.
- Shared UI: `src/components`; foundations: [design system](../../design.md).
- Web-only helpers and session handling: `src/lib`.
- Workspace persistence, provider protocols and inference: `@timeline/shared`, through scoped interfaces.

[Public document registry](../../docs/public-site-registry.md) owns public metadata/discovery; [domain ownership](../../docs/architecture/ownership.md) owns authority and presentation boundaries. The HTTP layer must not bypass them.

## Verification and deployment

Use [testing policy](../../docs/testing/README.md) and [Railway deployment](../../docs/railway.md). `scripts/prepare-standalone.mjs` prepares the production artifact; `start.mjs` runs startup migrations before serving. Environment values used during prerender require a rebuild when changed.
