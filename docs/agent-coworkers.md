# Agent coworkers — implementation and release notes

The discovery entry point is `/llms.txt`. Product research needs no account. Setup lives at
`/agents/setup.md`; operating behavior comes from `plugins/timeline/skills/timeline/SKILL.md`.
The public Markdown route and signed-in download read that same file. Plugin version 0.4.0
adds the coworker reporting agreement without adding a sixth advertised MCP tool.

## Identity and access

Signup retains a validated same-origin OAuth authorization request through credentials,
GitHub, and legal acceptance. Invitations retain precedence; a valid explicit authorization
request precedes pricing. Email verification carries an opaque reference to an account-bound
server record, never an arbitrary callback URL. It expires after 24 hours. Account-menu
resends preserve the latest live continuation. An expired request tells the user to restart
connection from their agent.

A new customer still establishes identity and accepts terms. Verified existing owners can
create a dedicated provisioning grant at `/app/agent-provisioning`. Grants create new
workspaces only, default to one workspace/seven days, and allow up to ten/thirty days.
Capture is opt-in. The owner-wide five-attempt hourly limit includes matching retries.
The provisioning API is documented separately at `/agents/provisioning.md`.

Provisioning credentials are hashed; replay receipts are encrypted with the existing secrets
key and usable for fifteen minutes. The janitor clears expired encrypted payloads while
retaining idempotency records. A receipt that has expired never creates another workspace.
Revoke provisioning and MCP access independently. Free eligibility remains owner-bound;
additional workspaces can be billing-restricted. UI/API workspace creation share defaults,
owner membership, calendar, digest destination, eligibility and creation audit behavior.

## Reporting agreement

Owners/admins manage workspace defaults and per-OAuth-grant/per-static-key overrides in
Connect your agent. Existing and new workspaces default to `on_request`. `handoffs` requires
a plain-text project/work scope. An override wins over the current workspace default;
removing it restores inheritance. Reauthorization preserves the same grant's override.
New grants and keys inherit. Names never identify preferences.

`timeline.get({kind: "connection"})` returns the authenticated team, connection identity,
scopes, effective reporting setting and revision. An OAuth user can inspect their own
connection. Connections cannot edit settings. Capture permission remains independent:
ongoing reporting never grants capture or authorizes external actions.

The skill refreshes context at the start of Timeline-dependent work and before automatic
reports. Failure to read preferences falls back to explicit requests. Reports contain
meaningful outcomes, decisions, blockers and next steps within scope, preserve attribution,
and exclude secrets/chatter. Capture is evidence, not approval of canonical changes.
Search misses mean no visible evidence; save a user-approved first brief once, then retrieve
its returned event ID. Indexing delays never justify duplicate writes.

## Rollout and monitoring

Apply additive migrations 0097–0099 before serving the new interfaces. Reporting defaults
backfill to on-request; existing keys and OAuth grants remain valid. Production deployment
is a separate action. Existing secrets encryption configuration is reused; no new secret
or environment variable is required.

Monitor structured `agent_provisioning_failed` codes/statuses and provisioning audit actions
(attempt, workspace.created, grant.created/revoked), existing OAuth authorization events,
and MCP capture failures. Never log credentials, receipt payloads or note content. Inspect
attempts without matching successful creation when investigating failures; an interrupted
client must retry the same idempotency key. Do not retry with a new key to recover credentials.

## Client verification boundaries

Reviewed current documentation for Codex MCP add/login, Hermes MCP OAuth/login, OpenClaw
Streamable HTTP OAuth and `mcp doctor --probe`, and xAI custom MCP connectors. Sources:

- <https://learn.chatgpt.com/docs/extend/mcp>
- <https://hermes-agent.nousresearch.com/docs/user-guide/features/mcp>
- <https://docs.openclaw.ai/tools/mcp>
- <https://docs.openclaw.ai/cli/mcp>
- <https://docs.x.ai/grok/connectors>

Local Codex CLI version: 0.163.0; command help inspected. Grok Bot, OpenClaw and Hermes
runtimes are unavailable here. Documentation review is not an install/authenticate/read/
report/retrieve end-to-end test. No claim of live compatibility for those clients is made.
Grok connector support alone does not establish a particular Grok Bot deployment's support.

## Skill acceptance scenarios

| Scenario | Expected behavior |
| --- | --- |
| Research only | Read public product documents; no signup or installation required. |
| Already connected | Read connection context; install nothing already working. |
| No visible evidence | State the search limit; never infer an empty workspace. |
| First contribution | Get approval for available brief, capture once, retrieve returned ID and cite. |
| Ongoing handoff | Refresh agreement; report only meaningful work in scope with capture permission. |
| User opts out | Narrow/suppress automatic reporting for the task. |
| Duplicate or indexing delay | Reuse known record identity; do not write again just to make search find it. |
| Capture failure | Disclose failure; never claim the handoff was saved. |
| Preferences unavailable | Explicit requests only; no inferred ongoing permission. |

## Local validation evidence — 2026-11-06

`bun run validate` passed (formatting, TypeScript, ESLint and Knip). Bun 1.4.4. React Doctor 0.9.18 reports 100 with no issues. MCP evaluations and
compiled-package import checks passed. Targeted tests cover auth redirects/continuations,
verification/resend/expiry, provisioning authority, limits, rollback and receipt replay,
reporting isolation/inheritance, OAuth reauthorization and canonical skill distribution.

Playwright 1.64.1 with Chromium 156.0.8078.4 passed both isolated browser journeys:
credentials signup → original OAuth consent → verification → original consent; and owner
grant creation → concurrent HTTP provisioning → connection inspection → capture → retrieve
by returned ID → reporting settings save. Migrations ran against a disposable local
PostgreSQL 16 database. No production data or credentials were used. The concurrent test
caught a foreign-key lock cycle; non-key row locks now serialize quota/idempotency updates
without blocking each other's foreign-key checks. The browser regression test remains.

GitHub's real identity-provider callback and client-specific install/login journeys were
not exercised live. Skill scenarios above are acceptance guidance; they are not evidence
of autonomous behavioral evaluation in all named clients. Application and test commands
were invoked through Bun; repository analyzer subprocesses can still invoke host Node.

The repository-referenced `/document-release` and `/ship` skills are unavailable in this
checkout/environment. Documentation and diff review were performed manually. Production
migration/release execution and unavailable live client checks remain separate work.
