# Timeline as an MCP server (outbound)

Expose Timeline as a remote MCP server so external agents can query events, entities, objects, tasks, boards, calendar, documents, and connected integration activity. The endpoint is `<your Timeline origin>/api/mcp/server`. The in-app setup screen is **Connect your agent** (`/app/connect-agent`): pick a client, complete OAuth, then expand Add memory, Timeline skill, or Advanced for the rest. `/app/team/mcp-share` redirects there. In this repository, bundled Codex and Claude Code connections declare only this URL, so OAuth discovery and member consent are the default path after the corresponding server release is deployed; static bearer keys remain available for manual and developer clients.

<span id="timeline-mcp-oauth"></span>

### OAuth discovery and consent

1.  Add the bundled plugin or configure the remote Streamable HTTP URL in an OAuth-capable MCP client. Do not add a static Authorization header to a bundled marketplace manifest.
2.  An unauthenticated call receives HTTP `401` with a `WWW-Authenticate` challenge pointing to the RFC 9728 protected-resource metadata. The authorization server publishes RFC 8414 metadata from the same origin.
3.  Sign in to Timeline, choose one team, and review the exact scopes. `read` is the default and is available to any active member. It acts as that member, so private and specifically shared data the member can access may be returned. `capture` has its own consent checkbox, is on by default, and authorizes `timeline.remember`. Unchecking it issues a read-only grant. `agent:ask` is optional, requires `read`, and can be granted only by a current owner or admin; demotion invalidates that elevated scope.
4.  Review the reporting agreement beneath the team and capture choices. New connections inherit the workspace default. Owners/admins can choose an on-request override or ongoing reporting with a work scope; members can inspect their own effective agreement. Explicit ongoing reporting requires capture, but inherited or retained agreements can remain inactive on read-only connections. Reauthorization preserves unchanged preferences. Reporting follows the skill while the agent works; it does not schedule background jobs.
5.  Revoke an approved AI app from **Connect your agent** (`/app/connect-agent`). Owners and admins see every team grant with the consenting member next to the client, so Revoke is tied to that member’s access. Token revocation and team membership removal take effect at authorization resolution rather than waiting for a plugin reinstall.

Timeline is a public-client OAuth authorization server: authorization code and refresh-token grants use PKCE S256, exact redirect matching, the MCP `resource` parameter, and authorization-response issuer binding. MCP's current Client ID Metadata Document (CIMD) model is preferred. Constrained Dynamic Client Registration remains available for compatible legacy clients; it accepts public clients only and issues no client secret. Discovered CIMD URLs pass the same HTTPS and SSRF guard as other user-supplied MCP URLs. Reauthorization after revocation, a scope or resource change, or a membership-authorization change replaces the prior token family; issuing a new consent code also invalidates any older unredeemed code for that app, member, and team.

OAuth authorization-code digests expire after ten minutes. Access- and refresh-token digests are retained until their refresh-token expiry, up to 30 days from issue, so replay attempts remain detectable. Revoked grant records become eligible for deletion after 31 days and only after their code and token rows are gone. The hourly maintenance worker removes eligible rows on its next successful sweep.

<span id="timeline-mcp-transport"></span>

### Transport and tool metadata

Use Streamable HTTP, not legacy SSE. The repository implementation uses the official MCP SDK v2 server transport and negotiates the current `2026-07-28` revision plus supported 2025 revisions. It routes `POST`, `GET`, and `DELETE` through one stateless endpoint; protocol work uses `POST`, notifications return `202`, and session-only `GET`/`DELETE` requests receive the SDK's `405` response because Timeline does not retain MCP sessions. Tool discovery includes titles, behavior annotations, input and output schemas, and tool calls return matching structured content. Resources and prompts use the same SDK transport.

<span id="timeline-agent-plugins"></span>

### Codex and Claude Code packages

Use the [plugin installation guide](../../plugins/timeline/skills/README.md). Packaging manifests are not directory publication.


### Static key setup

Use this path only for a client that needs an explicit header or for controlled developer testing. An admin opens **Connect your agent** (`/app/connect-agent`), expands *Advanced*, creates a key, and copies the one-time plaintext. Static-key remember is authored as the team actor, not a member. The optional *Allow capture notes* key setting adds `capture` and is on by default. The optional *Allow Timeline agent* key setting adds `agent:ask` and is off by default. Prefer OAuth.

For Codex CLI, keep the key in an environment variable:

    printf 'Timeline MCP key: '
    IFS= read -r -s TIMELINE_MCP_KEY
    printf '\n'
    export TIMELINE_MCP_KEY
    codex mcp add timeline --url "<copied MCP endpoint URL>" --bearer-token-env-var TIMELINE_MCP_KEY

Run that command in the terminal you will use for Codex CLI. Fully exit the current Codex process, relaunch `codex` from the same terminal, and start a new task. A new task cannot import an environment variable added after its Codex host started. Codex app and IDE users should store `TIMELINE_MCP_KEY=<one-time key>` in `~/.codex/.env` outside any repository, restrict that file to their user account, fully restart the app or extension, and then start a new task.

Remote-MCP JSON clients can use the same endpoint and bearer key:

    {
      "mcpServers": {
        "timeline": {
          "type": "streamable-http",
          "url": "<copied MCP endpoint URL>",
          "headers": {
            "Authorization": "Bearer tla_..."
          }
        }
      }
    }

This JSON contains the bearer key. Store it only in the client's protected local configuration, keep it out of repositories and shared folders, and follow that client's credential-storage guidance.

<span id="timeline-marketplace-release"></span>

### Directory publication

Use [the publication runbook](../marketplace-submissions.md); verify deployment and portal state independently.
