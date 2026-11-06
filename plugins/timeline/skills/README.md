# Timeline agent skill

The `timeline` skill teaches agents how to use Timeline's MCP tools as cited workspace memory. Installing the plugin is the easiest route because it adds the skill and hosted MCP connection together.

The bundled Codex and Claude Code connections use Timeline's OAuth flow. On first connection, a compatible host opens Timeline in the browser: sign in, choose the team to share, review the requested scopes, and approve or deny access. The default grant is `read` plus `capture`. `read` follows that member's visibility in the selected team, including private and specifically shared items the member can access. `capture` is on by default so `timeline.remember` can store cited evidence; uncheck it for a read-only grant. The optional `agent:ask` scope enables paid, proposal-only Timeline agent turns and is never implied by `read` or `capture`; only a current team owner or admin can grant it, and demotion invalidates it.

Agents can fetch the live setup instructions at [https://thetimeline.cc/agents/setup.md](https://thetimeline.cc/agents/setup.md). The published skill at [https://thetimeline.cc/agents/SKILL.md](https://thetimeline.cc/agents/SKILL.md) is byte-identical to [`timeline/SKILL.md`](./timeline/SKILL.md).

> Release status: these OAuth instructions describe this repository version. The hosted URL will not provide this flow until migration `0075_mcp_oauth_server.sql` and the matching web release are deployed. Repository packaging is not a public marketplace listing.

## Install in Codex

1. Add this repository as a sparse marketplace and install the plugin:

   ```bash
   codex plugin marketplace add timborovkov/the-timeline-ai \
     --ref main \
     --sparse .agents/plugins \
     --sparse plugins/timeline
   codex plugin add timeline@timeline
   ```

2. Fully exit the current Codex process, relaunch Codex, and start a new task so the installed skill and MCP connection are loaded.
3. When Codex starts the connection, complete Timeline's browser-based sign-in and consent flow. No Timeline bearer key belongs in the plugin manifest.

## Install in Claude Code

Add the repository marketplace and install the same plugin:

```bash
claude plugin marketplace add timborovkov/the-timeline-ai
claude plugin install timeline@timeline
```

Restart Claude Code after installation, start a new conversation, and complete Timeline's browser-based sign-in and consent flow when prompted. The repository contains Claude-specific marketplace and plugin manifests; this direct repository install does not mean the plugin has been reviewed or published in Anthropic's public marketplace.

OpenAI uses one universal Plugins Directory across ChatGPT and Codex. Timeline must be submitted there as a **With MCP** draft containing the production remote MCP connection and this same skill bundle; installing either repository manifest does not create or approve that listing. Anthropic's public Claude plugin marketplace and Claude.ai's separate Connectors Directory likewise have submission and review steps beyond this directly installable Claude Code repository marketplace.

## Install the standalone skill

Use this route when you want only the skill or operate a separately licensed customer-controlled Timeline deployment. Paste this into Codex:

```text
$skill-installer Install this Timeline skill from GitHub:
- https://github.com/timborovkov/the-timeline-ai/tree/main/plugins/timeline/skills/timeline
```

Then start a new task. If the skill still does not appear, restart Codex and start another new task. The standalone skill still needs a Timeline MCP connection.

## Connect Timeline MCP

For hosted Timeline, either plugin configures the remote URL automatically. Any MCP host that supports OAuth discovery and dynamic client registration can also connect directly to `https://thetimeline.cc/api/mcp/server` without a directory listing or plugin, once production `/.well-known/oauth-authorization-server` returns 200:

```bash
codex mcp add timeline --url "https://thetimeline.cc/api/mcp/server"
```

Use Streamable HTTP, not legacy SSE. The endpoint returns a standards-compatible `401` discovery challenge, then exposes OAuth protected-resource and authorization-server metadata. Authorization uses PKCE S256 and explicit user/team consent. Revoke an approved AI app later from **Connect your agent** in Timeline.

### Static key setup for manual clients

Static keys remain available for clients that need an explicit Authorization header or for controlled developer testing. As a Timeline team admin, open [Connect your agent](https://thetimeline.cc/app/connect-agent), create a key under Advanced, and copy its one-time plaintext. Static-key remember is authored as the team actor. Read it silently into the terminal that will launch the client:

```bash
printf 'Timeline MCP key: '
IFS= read -r -s TIMELINE_MCP_KEY
printf '\n'
export TIMELINE_MCP_KEY
codex mcp add timeline \
  --url "https://thetimeline.cc/api/mcp/server" \
  --bearer-token-env-var TIMELINE_MCP_KEY
codex
```

Run this in the terminal you will use for Codex. The final command launches Codex with the key available; start a new task there.

A default key exposes team-visible retrieval plus `capture` so `timeline.remember` can store cited ingest evidence. Private and specific-user events remain unavailable because the key represents the team, not a member. Static `tla_` keys belong only under Advanced. Uncheck **Allow capture notes** for a read-only key; remember then returns `insufficient_scope`. The optional **Allow Timeline agent** key setting adds `agent:ask`; it enables paid, stateless agent turns that may call enabled team-shared custom MCP tools and create proposals for human review, but it does not grant direct canonical writes. Third-party MCP tools may have their own external side effects.

Keep the key in an environment variable; do not paste it into agent chats, repository files, or shell command arguments. Some clients require the header in local JSON. Treat that file as a secret, keep it out of repositories and shared folders, and follow the client's secure credential-storage guidance.

## Customer-controlled Timeline

The bundled plugin connection targets the hosted service. For a separately licensed customer-controlled deployment, install the standalone skill and replace the URL in the direct MCP command with:

```text
https://<your-timeline-origin>/api/mcp/server
```

## Update

For Codex, refresh the marketplace, reinstall the plugin, and then start a new task:

```bash
codex plugin marketplace upgrade timeline
codex plugin add timeline@timeline
```

For Claude Code, update the repository marketplace and installed plugin, then restart:

```bash
claude plugin marketplace update timeline
claude plugin update timeline@timeline
```

## Included skill

- [`timeline`](./timeline/SKILL.md) — route workspace questions to `timeline.search`, `timeline.get`, `timeline.subject`, `timeline.ask`, and `timeline.remember`; expand material evidence; add notes on request or within an authorized scoped reporting agreement; and answer with citations and explicit uncertainty.

## Coworker reporting (0.4.0)

Start Timeline-dependent work with `timeline.get` using `kind="connection"`. Owners/admins set
workspace defaults and per-connection overrides in Connect your agent: on request, or meaningful
work and handoffs within a stated project scope. Refresh before automatic reporting. Preferences
do not grant capture permission. The installed skill, public skill and signed-in download share
one canonical file. See [rollout and validation boundaries](../../../docs/agent-coworkers.md).

A verified existing owner can delegate new-workspace creation through a dedicated provisioning
grant. Follow [provisioning.md](https://thetimeline.cc/agents/provisioning.md), linked from setup.
New customers still complete identity and legal acceptance themselves.
