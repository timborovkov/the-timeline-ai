# Marketplace verification observations

Dated observations retained from the 2026 submission work. They do not establish current deployment or publication. Current procedure: [marketplace submissions](../marketplace-submissions.md).

### Operator evidence: 2026-08-27

- Both strict Claude validators, the Codex plugin validator, and the OpenAI
  skill validator passed. Isolated Codex and Claude marketplace installs also
  installed `timeline` version `0.2.0` and exposed one skill plus the hosted MCP
  server.
- The canonical `bun run test` completed all six workspace tasks successfully in
  40 minutes 4 seconds, including the reordered serial PGlite suite, 2,107 web
  tests, and the worker unit and integration suites.
- Production `GET /.well-known/oauth-authorization-server` returned `404`.
- Production `GET /.well-known/oauth-protected-resource/api/mcp/server`
  returned `404`.
- A current-protocol unauthenticated `initialize` request returned `200` with
  legacy protocol version `2024-11-05`, server version `0.1.0`, and permissive
  `Access-Control-Allow-Origin: *`; the required OAuth challenge was absent.
- After sign-in to an OpenAI Personal organization, **Create plugin → With MCP**
  opened a **Complete identity verification** gate. The portal requires a
  verified developer identity before it will create or upload a plugin. No
  draft was created and no data was submitted.
- After sign-in to a Claude Free account, the public directory submission route
  opened **Organization settings** and reported that organization settings are
  available only on Claude Team and Enterprise plans. No submission was
  created and no data was submitted.
- The same Claude Free account exposed **Customize → Connectors → Add custom
  connector**, including the name and remote MCP URL fields. The connector was
  not saved because production still serves the legacy non-OAuth MCP release.

These observations are direct production and portal evidence. Signing in does
not clear provider identity, account-plan, or production deployment gates.

### Operator evidence: 2026-10-24

- Merged current `main` into PR #392, including privacy-safe analytics #391
  (`3d95c133`), consented PostHog traffic #433 (`f11bf97a`), and the dashboard
  legal-publication redirect fix #434 (`02cecd64`). Kept mainline PostHog env
  and analytics contracts, billing, task-category default-on, OpenRouter model
  pins, Qdrant on-disk/int8, and AI SDK 7 behavior. Later refresh also merged
  Node pin #435 (`f762eece`) and production-log causes #437 (`0955a3a9`). The
  OAuth migration remains `0075_mcp_oauth_server` with journal `when` strictly
  after main's `0073_legal_acceptance_history` and
  `0074_recall_join_metadata_minimization` (main added no later SQL).
- Browser MCP clients: `/oauth/register`, `/oauth/token`, and `/oauth/revoke`
  now answer `OPTIONS` preflight and attach the same public CORS as discovery
  (`Access-Control-Allow-Origin: *`, no credentials, explicit allowed headers).
- Repository MCP/OAuth follow-up on this branch: IPv6 loopback host matching
  (`localhost`, `127.0.0.1`, `::1`, `[::1]`), `invalid_client` mapped to HTTP
  `401`, extra redirect/PKCE-plain/credentialed-URI tests, and AI-apps grant UI
  tests. Plugin source files were not changed.
- `bun run validate` passed (Prettier, typecheck, ESLint, Knip).
- `bun run doctor` reported `React Doctor score: 100` and `No issues found!`.
- `bun run test` completed all six workspace tasks successfully after merging
  #435/#437 (web 2,362 tests).
- `bun run test:eval` and `bun run test:dist-imports` passed on that revision.
- Local `GET /.well-known/oauth-authorization-server` and
  `GET /.well-known/oauth-protected-resource/api/mcp/server` returned `200` with
  `read`, `capture`, plus `agent:ask`, PKCE `S256`, public-client token auth `none`, and
  revocation advertised.
- Local unauthenticated `POST /api/mcp/server` returned `401` with
  `WWW-Authenticate` pointing at the protected-resource metadata document.
- Browser consent for a local public client showed team selection, explicit
  `read`, default-on `capture`, and optional owner/admin `agent:ask`, the loopback-HTTP warning, and
  the granted AI app with a revoke control on Provider accounts.

Plugin validators and isolated Codex/Claude installs were not re-run in this
refresh because `plugins/timeline` and the marketplace manifests did not change.
Production still serves the legacy MCP implementation; the 2026-08-27 production
and portal gates remain open.

### Hosts verified so far

| Host | What was verified | Date | Production OAuth |
| --- | --- | --- | --- |
| Local Timeline origin | Discovery documents 200, unauthenticated MCP `401` challenge, DCR, browser consent, grant revoke UI (Claude-shaped public client, including loopback HTTP) | 2026-10-24 | Not applicable |
| Codex CLI | Isolated repository marketplace add/install of `timeline@timeline` 0.2.0 | 2026-08-27 | Not verified; plugin install is not live OAuth |
| Claude Code | Isolated repository marketplace add/install; one skill plus hosted MCP component | 2026-08-27 | Not verified; plugin install is not live OAuth |
| ChatGPT (With MCP / Developer Mode) | Portal identity-verification gate observed; no connection | 2026-08-27 | Not verified |
| Claude.ai custom connector | Personal **Add custom connector** form observed; connector not saved | 2026-08-27 | Not verified |

Re-test ChatGPT and Claude against the deployed production origin before
relaxing `state` or `resource` checks for less strict hosts.
