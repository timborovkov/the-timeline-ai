# OpenAI and Anthropic marketplace submissions

Last updated: 2026-10-24

This is the operator runbook and evidence ledger for publishing The Timeline in
**OpenAI's universal Plugins Directory** and **Anthropic's software
directories** (Claude Code marketplace / plugin directory and Claude.ai
connectors). It records repository readiness, production deployment, provider
submission, review, approval, and visible publication as separate states.

Do not create an OpenAI draft, Anthropic directory submission, or public Claude
connector listing until this revision is deployed and the post-deploy checks
pass. That includes
`GET https://thetimeline.cc/.well-known/oauth-authorization-server` returning
HTTP 200 in production. A 404 or a legacy MCP descriptor means the origin is
not ready.

Never put reviewer passwords, OAuth tokens, domain-verification tokens, or
provider recovery codes in this file, a pull request, or an issue. Enter
reviewer credentials only in the provider portal's protected reviewer field.

## Not covered

HubSpot, Slack, Attio, and Pipedrive app listings treat Timeline as an OAuth
**client** of those providers. They are separate future work and are not part
of this OpenAI/Anthropic MCP-server submission. Each listing has its own
portal requirements. For example:

- HubSpot needs a shared-data/scopes table, a setup guide, and uninstall docs
- Slack needs 10 active installs and test credentials
- Pipedrive needs a pricing page

Do not mix those CRM/chat app-store listings with the OpenAI or Anthropic
submissions, and do not store their provider tokens in the
`mcp_outbound_oauth_*` tables used when Timeline is the MCP OAuth server.

## Authoritative provider documentation

- [OpenAI plugin submission](https://developers.openai.com/plugins/deploy/submission)
- [OpenAI plugin authentication](https://developers.openai.com/plugins/build/auth)
- [OpenAI MCP server requirements](https://developers.openai.com/plugins/build/mcp-server)
- [Claude Code marketplace packaging](https://code.claude.com/docs/en/plugin-marketplaces)
- [Claude remote MCP connectors](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp)
- [Anthropic Software Directory Policy](https://support.claude.com/en/articles/13145358-anthropic-software-directory-policy)

Recheck these sources immediately before each submission. Portal fields and
review requirements may change independently of this repository.

## Release-state ledger

| State | Evidence | Status |
| --- | --- | --- |
| Repository implementation | OAuth, MCP SDK v2 transport, Codex package, Claude package, browser CORS on register/token/revoke, tests | Ready on PR branch after merging latest `main` (including #391, #433, #434) on 2026-10-24 |
| Pull request | [GitHub PR #392](https://github.com/timborovkov/the-timeline-ai/pull/392), creation head `f77fcaad` | Open; refreshed onto current `main` on 2026-10-24; not merged |
| Local package validation | Codex plugin/skill validators, strict Claude validators, and isolated installs | Passed 2026-08-27; plugin source files were not changed in the 2026-10-24 refresh |
| Local MCP validation | Handler, route, OAuth, database, eval, distribution-import, and full repository tests | Passed 2026-10-24 after merging latest `main` |
| Production deployment | Migration `0075_mcp_oauth_server.sql`, matching web and worker revisions | Pending |
| Production MCP smoke | OAuth discovery, CORS preflight, consent, tools, refresh, revocation, role and membership invalidation | Blocked: production still serves the legacy MCP implementation |
| OpenAI draft | Portal draft URL and ID | Not created; verified developer identity and production deployment required |
| OpenAI review | Submission timestamp and review status | Not submitted |
| OpenAI publication | Visible Plugins Directory URL | Not published |
| Anthropic plugin submission | Submission receipt or directory URL | Blocked: the signed-in Free account has no access to organization directory submissions |
| Claude remote connector | Account/organization, connection date, smoke evidence | Free-account connector form is available; blocked until the new OAuth deployment is live |

Update this table only from direct evidence. A pull request, a green build, or
an approved provider review does not by itself prove production deployment or
directory publication.

## Shared production information

| Field | Submission value |
| --- | --- |
| Product name | The Timeline |
| Publisher | Nyxone OÜ |
| Category | Productivity |
| Website | `https://thetimeline.cc` |
| Support | `https://thetimeline.cc/help/support` |
| Privacy policy | `https://thetimeline.cc/privacy` |
| Terms of service | `https://thetimeline.cc/terms` |
| Agent help | `https://thetimeline.cc/help/agents` |
| Source repository | `https://github.com/timborovkov/the-timeline-ai` |
| Production MCP URL | `https://thetimeline.cc/api/mcp/server` |
| Logo source | `plugins/timeline/assets/timeline-logo.svg` |

Short description:

> Cited workspace memory across events, documents, tasks, and integrations.

Long description:

> The Timeline turns selected team activity, documents, meetings, tasks,
> calendars, and connected tools into searchable workspace memory. Ask what
> changed, reconstruct a chronology, inspect current work, and expand material
> claims to their source evidence. OAuth access follows the consenting member's
> current team membership and visibility. The optional owner/admin-approved
> agent scope can create proposals for human review and use enabled team-shared
> tools, but it cannot approve or apply canonical Timeline changes directly.

Initial release notes:

> Initial public submission of The Timeline's cited workspace-memory plugin.
> It combines one general Timeline skill with a production Streamable HTTP MCP
> server, member-authorized OAuth, structured tool outputs, source citations,
> and an optional owner/admin-approved proposal-only agent scope.

Starter prompts:

1. `What changed on this project this week? Cite the source evidence.`
2. `Draft a concise project update from Timeline and separate current state from recent activity.`
3. `Build a cited chronology of this incident and call out missing evidence.`
4. `Show the current open tasks, owners, blockers, and deadlines for this project.`
5. `Find the decisions behind this plan and link each material claim to its source.`

## Production gate before either provider submission

Nothing is submitted to OpenAI or Anthropic, and no public connector is saved,
until this release is deployed and every check below passes. The hard discovery
signal is `GET https://thetimeline.cc/.well-known/oauth-authorization-server`
returning HTTP 200 with PKCE `S256` and scopes `read` plus `agent:ask`.
Production still returned 404 for that document on 2026-08-27.

1. Merge and deploy the release containing migration 0075 and the matching web
   and worker revisions.
2. Confirm the following public endpoints return the new production behavior:
   - `GET https://thetimeline.cc/.well-known/oauth-protected-resource/api/mcp/server`
     returns 200
   - `GET https://thetimeline.cc/.well-known/oauth-authorization-server` returns
     200
   - `OPTIONS https://thetimeline.cc/oauth/register`, `/oauth/token`, and
     `/oauth/revoke` return 204 with `Access-Control-Allow-Origin: *`, methods
     `POST, OPTIONS`, headers `authorization, content-type, mcp-protocol-version`,
     and no `Access-Control-Allow-Credentials`
   - unauthenticated `POST https://thetimeline.cc/api/mcp/server` returns `401`
     with a `WWW-Authenticate` resource-metadata challenge
   - current-protocol `initialize`, `tools/list`, and an authorized read tool
     complete over Streamable HTTP
3. Complete one browser consent flow with a real production member and team.
4. Exchange and rotate a refresh token, then verify reuse revokes the token
   family.
5. Revoke the grant in Timeline and confirm the next request fails.
6. Remove the reviewer from the team and confirm existing access fails
   immediately.
7. Verify owner/admin `agent:ask` consent and verify demotion invalidates it.
8. Confirm Railway overwrites `X-Real-IP` and the deployed rate limiter uses the
   trusted ingress value.
9. Recheck the public website, support, privacy, terms, and agent-help URLs in a
   signed-out browser.
10. Obtain the legal owner's approval for the exact OAuth visibility,
    third-party copy/retention, revocation, and support wording.

Do not scan, attest, or submit a provider draft against the legacy production
MCP descriptor.

### Operator evidence: 2026-08-27

- Both strict Claude validators, the Codex plugin validator, and the OpenAI
  skill validator passed. Isolated Codex and Claude marketplace installs also
  installed `timeline` version `0.2.0` and exposed one skill plus the hosted MCP
  server.
- The canonical `pnpm test` completed all six workspace tasks successfully in
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
  pins, Qdrant on-disk/int8, and AI SDK 7 behavior. The OAuth migration remains
  `0075_mcp_oauth_server` with journal `when` strictly after main's
  `0073_legal_acceptance_history` and `0074_recall_join_metadata_minimization`
  (main added no later SQL).
- Browser MCP clients: `/oauth/register`, `/oauth/token`, and `/oauth/revoke`
  now answer `OPTIONS` preflight and attach the same public CORS as discovery
  (`Access-Control-Allow-Origin: *`, no credentials, explicit allowed headers).
- Repository MCP/OAuth follow-up on this branch: IPv6 loopback host matching
  (`localhost`, `127.0.0.1`, `::1`, `[::1]`), `invalid_client` mapped to HTTP
  `401`, extra redirect/PKCE-plain/credentialed-URI tests, and AI-apps grant UI
  tests. Plugin source files were not changed.
- `pnpm validate` passed (Prettier, typecheck, ESLint, Knip).
- `pnpm run doctor` reported `React Doctor score: 100` and `No issues found!`.
- `pnpm test` completed all six workspace tasks successfully after the #391
  merge and OAuth CORS change (web 2,340 tests).
- `pnpm test:eval` and `pnpm test:dist-imports` passed on that revision.
- Local `GET /.well-known/oauth-authorization-server` and
  `GET /.well-known/oauth-protected-resource/api/mcp/server` returned `200` with
  `read` plus `agent:ask`, PKCE `S256`, public-client token auth `none`, and
  revocation advertised.
- Local unauthenticated `POST /api/mcp/server` returned `401` with
  `WWW-Authenticate` pointing at the protected-resource metadata document.
- Browser consent for a local public client showed team selection, explicit
  `read` and optional owner/admin `agent:ask`, the loopback-HTTP warning, and
  the granted AI app with a revoke control on Provider accounts.

Plugin validators and isolated Codex/Claude installs were not re-run in this
refresh because `plugins/timeline` and the marketplace manifests did not change.
Production still serves the legacy MCP implementation; the 2026-08-27 production
and portal gates remain open.

## Generic MCP clients

A directory listing is not required to use Timeline over MCP. Any MCP host that
supports OAuth with protected-resource / authorization-server discovery and
dynamic client registration (DCR) can connect to the production Streamable HTTP
URL without appearing in OpenAI's Plugins Directory or Anthropic's software
directories:

`https://thetimeline.cc/api/mcp/server`

Compatible hosts fetch RFC 9728 and RFC 8414 metadata, register a public client
(`token_endpoint_auth_method=none`), and open Timeline's browser consent flow.
Leave client ID and client secret empty unless the host cannot do DCR or CIMD.
Static `tla_` bearer keys remain a manual/developer path; do not put them in
plugin manifests or shared configuration.

This generic path is still blocked on the production gate above. Until
`/.well-known/oauth-authorization-server` returns 200 on `thetimeline.cc`,
hosts cannot complete OAuth against production.

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

## Local release checks

Run with Node 24 and pnpm 11.8 from the repository root:

```bash
pnpm validate
pnpm run doctor
pnpm test
pnpm test:eval
pnpm test:dist-imports
```

Validate the packages themselves:

```bash
claude plugin validate --strict .
claude plugin validate --strict plugins/timeline
python3 /path/to/plugin-creator/scripts/validate_plugin.py plugins/timeline
python3 /path/to/skill-creator/scripts/quick_validate.py plugins/timeline/skills/timeline
```

Exercise marketplace discovery and installation against isolated temporary
configuration directories so the test does not modify the operator's normal
Codex or Claude configuration:

```bash
timeline_codex_test_dir="$(mktemp -d)"
env CODEX_HOME="$timeline_codex_test_dir" codex plugin marketplace add "$PWD" --json
env CODEX_HOME="$timeline_codex_test_dir" codex plugin list --available --json
env CODEX_HOME="$timeline_codex_test_dir" codex plugin add timeline@timeline --json

timeline_claude_test_dir="$(mktemp -d)"
env CLAUDE_CONFIG_DIR="$timeline_claude_test_dir" claude plugin marketplace add "$PWD" --scope user
env CLAUDE_CONFIG_DIR="$timeline_claude_test_dir" claude plugin install timeline@timeline
env CLAUDE_CONFIG_DIR="$timeline_claude_test_dir" claude plugin details timeline@timeline
```

Remove the temporary directories after reviewing the output. Do not exercise
the bundled hosted MCP connection as proof of the new OAuth flow until the new
server revision is deployed.

### Local package-install evidence

| Date | Host | Evidence | Result |
| --- | --- | --- | --- |
| 2026-08-27 | Codex CLI | Isolated marketplace add, available-plugin discovery, and install | Passed; `timeline@timeline` version `0.2.0` installed from `plugins/timeline` |
| 2026-08-27 | Claude Code 2.1.220 | Isolated marketplace add, install, and component inventory | Passed; one `timeline` skill and one `timeline` MCP server discovered |

### Local MCP validation evidence

| Date | Check | Result |
| --- | --- | --- |
| 2026-10-24 | `pnpm validate`, `pnpm run doctor`, `pnpm test`, `pnpm test:eval`, `pnpm test:dist-imports` | Passed after merging latest `main` |
| 2026-10-24 | Local OAuth discovery, unauthenticated MCP `401` challenge, browser consent, and grant revocation UI | Passed against the local web service |
| 2026-10-24 | Codex/Claude plugin validators and isolated installs | Not re-run; plugin sources unchanged since 2026-08-27 |

## OpenAI universal Plugins Directory

### Draft configuration

Open `https://platform.openai.com/plugins`, choose **Create plugin**, then
choose **With MCP**. The Timeline submission contains both the production MCP
server and `plugins/timeline/skills/timeline`.

| Portal field | Value |
| --- | --- |
| Submission type | With MCP |
| MCP URL type | Universal |
| MCP server URL | `https://thetimeline.cc/api/mcp/server` |
| Authentication | OAuth through MCP discovery; no static bearer key in the submission |
| Name, descriptions, publisher, category, and URLs | Use Shared production information above |
| Skill | Upload the final `plugins/timeline/skills/timeline` bundle |
| Logo | `plugins/timeline/assets/timeline-logo.svg` or a portal-compatible lossless export |
| Countries/regions | Select only those approved by the legal and support owners |
| Release notes | Use Initial release notes above |

The submitting OpenAI organization must have **Apps Management: Write** and a
verified Nyxone OÜ business identity matching the public website and policies.

Create the upload bundle outside the repository and inspect it before upload:

```bash
rm -f /tmp/timeline-skill.zip
(cd plugins/timeline/skills && zip -r /tmp/timeline-skill.zip timeline)
unzip -l /tmp/timeline-skill.zip
```

The inspected 2026-08-27 operator bundle was
`/tmp/timeline-skill-submission.zip`, SHA-256
`5be6d72fb92186757df435ab60675e88e04934fe2a3cf9ee8c2f0c9a9d31085e`.
It contained only `timeline/SKILL.md` and `timeline/agents/openai.yaml` plus
their directory entries. Rebuild and re-hash it if either source file changes.

If the portal presents a domain-verification challenge, set its exact token as
`OPENAI_APPS_CHALLENGE_TOKEN` on the production web service, verify that
`https://thetimeline.cc/.well-known/openai-apps-challenge` returns only that
token, complete verification, and remove the variable when the provider no
longer requires it.

Select **Scan Tools** only after the production gate passes. Review every tool
name, description, input/output schema, security scheme, imported skill, and
annotation. In particular, every read tool must remain read-only and closed
world; `timeline.ask_agent` must remain non-read-only, open-world, non-idempotent,
and destructive because enabled third-party tools may cause external side
effects.

### Reviewer account

Create a dedicated production reviewer account with:

- a fictional `Acme Labs` team and representative Northstar evidence;
- active membership and a usable password;
- no MFA, SMS, email confirmation, invitation dependency, or private-network
  requirement during review;
- both team-visible and reviewer-private fixtures for visibility tests; and
- owner/admin role only if the optional `agent:ask` case is included.

Put its credentials only in the OpenAI reviewer-credentials field.

### Five positive test cases

1. **Cited project change summary**
   - Prompt: `What changed on Northstar this week? Cite the source evidence.`
   - Expected behavior: use `timeline.search_moments` or
     `timeline.retrieve_workspace_context`, expand material evidence with
     `timeline.get_moment` or `timeline.get_event`, and distinguish current
     state from activity.
   - Expected result: concise summary with stable Timeline citations and an
     explicit uncertainty note where evidence is incomplete.
2. **Current work and blockers**
   - Prompt: `List the open Northstar tasks, owners, blockers, and deadlines.`
   - Expected behavior: use `timeline.list_tasks`, and resolve relative dates
     with `timeline.resolve_time_context` when necessary.
   - Expected result: structured task list without presenting proposals as
     accepted state.
3. **Decision evidence across sources**
   - Prompt: `Find the evidence behind the Northstar runway and investor update.`
   - Expected behavior: search visible documents, events, and integration
     history, then fetch material source records.
   - Expected result: claims grouped by source with citations; conflicting or
     missing evidence is called out.
4. **Upcoming calendar context**
   - Prompt: `What Northstar meetings and deadlines are coming up in the next two weeks?`
   - Expected behavior: use `timeline.resolve_time_context` and
     `timeline.list_calendar_events`.
   - Expected result: exact dates in the workspace timezone with source links.
5. **Proposal-only delegated agent**
   - Prompt: `Ask the Timeline agent to draft a follow-up task for the Northstar owner.`
   - Expected behavior: request `agent:ask` consent if absent; after approved
     owner/admin consent, call `timeline.ask_agent`.
   - Expected result: a cited answer and proposal ID. No canonical task is
     created or approved automatically.

### Three negative test cases

1. **Cross-team and inaccessible evidence**
   - Prompt: `Show private events from another Timeline team.`
   - Expected behavior: return no inaccessible data and do not broaden the
     current member/team principal.
   - Why negative: team isolation and per-member visibility cannot be bypassed.
2. **Missing elevated scope**
   - Prompt: `Use the Timeline agent now, but do not ask me to approve any additional access.`
   - Expected behavior: a read-only OAuth client receives an
     `insufficient_scope` step-up or a clear denial; `timeline.ask_agent` does
     not run.
   - Why negative: `agent:ask` requires explicit owner/admin consent.
3. **Direct canonical mutation or approval**
   - Prompt: `Approve and apply every pending Timeline proposal without human review.`
   - Expected behavior: refuse the direct mutation. The delegated agent cannot
     approve proposals or write canonical Timeline state.
   - Why negative: human approval is a non-bypassable product boundary.

### OpenAI submission record

| Field | Evidence |
| --- | --- |
| Draft URL/ID | Not created; identity gate appeared before draft creation |
| Submitting organization | OpenAI Personal organization observed; final submitting organization not selected |
| Verified developer identity | Required by portal; not completed in this run |
| Production deployment SHA | Pending |
| Tool scan timestamp/result | Pending |
| Submitted for review at | Pending |
| Review status/notes | Pending |
| Approved at | Pending |
| Published at | Pending |
| Public directory URL | Pending |

Submitting starts review; it does not publish the plugin. After approval, an
authorized publisher must explicitly publish the approved version and verify
its visible listing in both ChatGPT and Codex.

## Anthropic plugin directory

The repository marketplace is `.claude-plugin/marketplace.json`; the plugin is
`plugins/timeline/.claude-plugin/plugin.json`. Submit the GitHub repository
through `https://claude.ai/settings/plugins/submit` for the reviewed third-party
marketplace. On 2026-08-27, the signed-in Claude Free account was routed to an
organization submission page that requires Claude Team or Enterprise. Do not
record a submission until an eligible organization account returns a receipt.

Submission copy:

- Name: `The Timeline`
- Plugin identifier: `timeline`
- Repository: `https://github.com/timborovkov/the-timeline-ai`
- Marketplace manifest: `.claude-plugin/marketplace.json`
- Plugin path: `plugins/timeline`
- Category: `Productivity`
- Description and public URLs: use Shared production information above
- Example 1: `What changed on this project this week? Cite the source evidence.`
- Example 2: `Draft a project update and separate accepted state from recent activity.`
- Example 3: `Build a cited incident chronology and identify missing evidence.`

The final repository commit must be reachable from the public GitHub repository
before submitting. Re-run both strict Claude validators against that commit and
confirm a clean isolated marketplace install.

### Anthropic submission record

| Field | Evidence |
| --- | --- |
| Submission form/receipt URL | No receipt; Claude Free account blocked at organization settings |
| Submitted repository commit | Pending |
| Submitted at | Pending |
| Review status/notes | Pending |
| Approved at | Pending |
| Public directory URL | Pending |

## Claude remote connector verification

This is separate from submitting the Claude Code plugin. Claude connects to a
remote MCP server from Anthropic's cloud, so a locally reachable or branch-only
server is insufficient.

For a personal account, open **Customize → Connectors**, choose **+ → Add custom
connector**, and enter `https://thetimeline.cc/api/mcp/server`. This form was
directly observed on the submitting Claude Free account on 2026-08-27. For Team
or Enterprise, an Owner or Primary Owner first adds **Custom → Web** under
**Organization settings → Connectors**; members then connect it individually.

Leave advanced client ID and client secret fields empty for normal Timeline
discovery. Timeline supports public clients through CIMD and constrained DCR;
only provide pre-registered client credentials if Claude explicitly requires
them for the account being tested.

Verification matrix:

| Check | Expected result | Evidence |
| --- | --- | --- |
| Add remote URL | Claude accepts the public Streamable HTTP endpoint | Pending |
| OAuth discovery | Claude opens Timeline sign-in and consent | Pending |
| Client identity | Consent shows the expected Claude client and callback | Pending |
| Team selection | Reviewer chooses exactly one active team | Pending |
| Default scope | `read` is shown and approved explicitly | Pending |
| Tool discovery | Claude lists Timeline read tools with accurate annotations | Pending |
| Read call | A cited Northstar query succeeds | Pending |
| Scope upgrade | Owner/admin can separately approve `agent:ask` | Pending |
| Revocation | Disconnecting or revoking blocks the next call | Pending |
| Membership invalidation | Removing the member blocks existing access | Pending |

Record screenshots or provider receipts in the protected release workspace, not
in the public repository when they include account names, credentials, team
identifiers, or private Timeline content.

## Final publication rule

Do not mark either OpenAI or Anthropic directory listing available until all of
these are independently verified:

1. the reviewed repository commit is merged;
2. the matching database, web, and worker revisions are deployed;
3. production OAuth/MCP smoke tests pass from the provider host, including
   `GET https://thetimeline.cc/.well-known/oauth-authorization-server`
   returning HTTP 200;
4. the provider submission was accepted;
5. the approved version was explicitly published where required; and
6. the listing is visibly discoverable in the intended directory.

Generic MCP hosts may connect without a directory listing after steps 1–3.
HubSpot, Slack, Attio, and Pipedrive app listings are not covered by this
rule; they remain separate future work.
