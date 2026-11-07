<p align="center">
  <img src="./docs/timeline-logo.svg" alt="The Timeline logo" width="112" height="112" />
</p>

<h1 align="center">The Timeline</h1>

<p align="center">
  An auto-updating work record from Slack, Telegram, email and calls, with cited answers.
</p>

<p align="center">
  <a href="https://thetimeline.cc">Website</a> ·
  <a href="https://thetimeline.cc/help">Help</a> ·
  <a href="./SUPPORT.md">Support</a> ·
  <a href="./CONTRIBUTING.md">Contributing</a> ·
  <a href="./plugins/timeline/skills/README.md">Agent plugins</a> ·
  <a href="./docs/setup/local.html">Local setup</a> ·
  <a href="./docs/index.html">Developer docs</a>
</p>

The Timeline keeps client, deal, task and decision records up to date from Slack,
Telegram, email and calls. Every line has its source, and suggested durable
workspace changes wait for human approval.

## Features

- Capture notes, messages, voice memos, files and meetings.
- Connect Slack, GitHub, Linear, Google Drive, Monday.com, Sentry and custom MCP servers.
- Search across projects, people, tasks, documents and calendars.
- Generate cited answers, project updates, daily digests and handoff briefs.
- Keep access scoped to each team and its source visibility settings.
- Connect external agents through the [Timeline plugins and MCP interface](plugins/timeline/skills/README.md). Agents read cited context over MCP and write notes through remember, ingest email, or an authenticated webhook. They can fetch [setup.md](https://thetimeline.cc/agents/setup.md) and the [published skill](https://thetimeline.cc/agents/SKILL.md).

The project is under active development; APIs and migrations may change.

## Getting started

Use the hosted app at [thetimeline.cc](https://thetimeline.cc), or follow the
[local development guide](docs/setup/local.html) to work on the code.

Local development requires **Bun 1.4.4** (pinned in `.bun-version`) and **Docker**.
The setup guide covers dependencies, environment variables, infrastructure,
database migrations and starting the app at `http://localhost:3000`.

For a populated workspace, see the [demo guide](docs/demo-corpus.md), including
seed/reset commands and test logins. The verified demo requires a development
OpenRouter API key for indexing. Existing PostgreSQL 16 installations must follow
the [PostgreSQL 18 upgrade guide](docs/setup/postgres18.md) before updating.

## Repository layout

| Path | Purpose |
| --- | --- |
| `apps/web` | Next.js app, public website and API routes |
| `apps/worker` | Background jobs for capture, extraction and sync |
| `packages/db` | Database schema and migrations |
| `packages/shared` | Data access, AI, integrations and domain logic |
| `packages/test-support` | Shared test utilities |
| `plugins/timeline` | Agent plugins and skills |
| `docs` | Architecture, setup and operations guides |

The stack uses PostgreSQL, Redis, Qdrant and S3-compatible storage, with model
calls routed through a shared OpenRouter inference layer.

## Development

Common commands, after completing local setup:

| Command | Purpose |
| --- | --- |
| `bun run dev` | Start the web app and workers |
| `bun run validate` | Check formatting, TypeScript, ESLint and Knip |
| `bun run test` | Run offline unit and integration tests |
| `bun run doctor` | Run React Doctor |

See [AGENTS.md](AGENTS.md) for repository conventions and change-specific checks.

## Documentation

- [Developer documentation](docs/index.html)
- [Architecture and memory model](docs/relational-memory.md)
- [Integrations and MCP](docs/setup/integrations.html)
- [Deployment](docs/railway.html) and [operations](docs/operations.md)
- [Design system](design.md)
- [Security and privacy](https://thetimeline.cc/trust)

## Contributing and support

Read [CONTRIBUTING.md](CONTRIBUTING.md) and agree the scope with a maintainer before
starting substantial work. For help or bug reports, see [SUPPORT.md](SUPPORT.md).
Report security vulnerabilities privately through [SECURITY.md](SECURITY.md).

## License

This repository does not currently include an open-source license. Public access
to the source does not grant general permission to copy, modify, redistribute or
self-host it. See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution guidance.
