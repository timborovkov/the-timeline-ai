# Agent coworkers — implementation and release notes

The discovery entry point is `/llms.txt`. Product research needs no account. Setup lives at
`/agents/setup.md`; operating behavior comes from `plugins/timeline/skills/timeline/SKILL.md`.
The public Markdown route and signed-in download read that same file. Plugin version 0.5.0
adds the coworker reporting agreement without adding a sixth advertised MCP tool.

## Identity and access

Signup retains a validated same-origin OAuth authorization request through credentials,
GitHub, and legal acceptance. Invitations retain precedence; a valid explicit authorization
request precedes pricing. Email verification carries an opaque reference to an account-bound
server record, never an arbitrary callback URL. It expires after 24 hours and is consumed
when verification succeeds. Account-menu resends keep the latest live OAuth destination even
when the current page is not `/oauth/authorize`. Resolve matches the account email
case-insensitively. An expired or already-used request tells the user to restart connection
from their agent.

A new customer still establishes identity and accepts terms. Verified existing owners can
create a dedicated provisioning grant at `/app/agent-provisioning`. Soft-removed owner
memberships do not qualify. Grants create new workspaces only, default to one workspace/seven
days, and allow up to ten/thirty days.
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
| Restart continuation | Resume connection verification and the task; do not restart installation or consent. |
| First useful retrieval | Retrieve bounded task context and give a cited answer; no capture required. |
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

## Consent agreement update — 2026-11-07

OAuth consent now establishes workspace, reporting mode and work scope in the existing screen.
New connections inherit the workspace default. Owners/admins can select a connection override;
members inspect only their own effective agreement. Changing workspace discards unsaved reporting
choices while preserving the capture checkbox. Existing overrides and revisions survive unchanged
reauthorization, including read-only connections where reporting is inactive.

Explicit ongoing reporting requires capture permission and a nonempty scope of at most 1,000
characters. Preference changes, audit entries, grant updates and authorization codes commit in one
transaction, with current membership/role checked under lock. Validation errors retain the draft
in the consent form. Scope text is never put in redirect URLs or exception telemetry. Missing
reporting fields preserve compatibility with older forms. No migration or public API/tool is added.

Setup and the canonical 0.5.0 skill verify connection context, confirm the agreement once, retrieve
relevant evidence, and finish a useful task. A cited answer is sufficient. When no evidence is
visible, preview a proposed brief and obtain approval before capture; retain returned identifiers
through indexing/retrieval delays. Already-connected and research-only use avoid onboarding prompts.
Reporting still depends on agent behavior, not background scheduling. Provisioning defaults remain
on request; static-key and provisioning preferences stay in Connect your agent.

Additional acceptance scenarios: inherited ongoing defaults, read-only inherited/retained settings,
workspace switches, member inspection, role changes before approval, preserved form drafts on error,
unchanged reauthorization revisions, and rollback when code issuance fails. Live GitHub and named
client-specific journeys remain unavailable; isolated browser tests exercise local OAuth consent.

Local validation for this update used Bun 1.4.4, React Doctor 0.9.18 (100, no issues),
Playwright 1.64.1 and Chromium 156.0.8078.4. All four isolated browser journeys passed:
signup/verification through consent, provisioning/read/capture/retrieval, owner configuration with
workspace switching and unchanged reauthorization/denial, and member inspection with forged-change
rejection followed by read-only approval. The last journey caught and now guards against React's
native form reset rechecking capture after a returned validation error. The disposable PostgreSQL
database had zero users/teams after cleanup, its audit protection remained enabled, and it was dropped.

Targeted OAuth/reporting, consent action/page/component, public document, setup snapshot and canonical
skill distribution tests passed, as did MCP evaluations and compiled-package import checks.
`bun run validate` passed formatting, TypeScript, ESLint and Knip.
Skill acceptance scenarios remain documented expectations rather than live evaluations in Codex,
Grok Bot, OpenClaw or Hermes. No production deployment was performed.
