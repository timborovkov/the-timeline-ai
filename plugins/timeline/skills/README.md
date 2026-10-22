# Timeline agent skill

The `timeline` skill teaches agents how to use Timeline's MCP tools as cited workspace memory. Installing the plugin is the easiest route because it adds the skill and hosted MCP connection together.

The bundled Codex and Claude Code connections use Timeline's OAuth flow. On first connection, a compatible host opens Timeline in the browser: sign in, choose the team to share, review the requested scopes, and approve or deny access. The default `read` scope follows that member's visibility in the selected team, including private and specifically shared items the member can access. The optional `agent:ask` scope enables paid, proposal-only Timeline agent turns and is never implied by `read`; only a current team owner or admin can grant it, and demotion invalidates it.

> Release status: these OAuth instructions describe this repository version. The hosted URL will not provide this flow until migration `0073_mcp_oauth_server.sql` and the matching web release are deployed. Repository packaging is not a public marketplace listing.

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

Use this route when you want only the skill or when your Timeline is self-hosted. Paste this into Codex:

```text
$skill-installer Install this Timeline skill from GitHub:
- https://github.com/timborovkov/the-timeline-ai/tree/main/plugins/timeline/skills/timeline
```

Then start a new task. If the skill still does not appear, restart Codex and start another new task. The standalone skill still needs a Timeline MCP connection.

## Connect Timeline MCP

For hosted Timeline, either plugin configures the remote URL automatically. A compatible OAuth-capable client can also connect directly without a plugin:

```bash
codex mcp add timeline --url "https://thetimeline.cc/api/mcp/server"
```

Use Streamable HTTP, not legacy SSE. The endpoint returns a standards-compatible `401` discovery challenge, then exposes OAuth protected-resource and authorization-server metadata. Authorization uses PKCE S256 and explicit user/team consent. Revoke an approved AI app later from **Provider accounts** in Timeline.

### Static key setup for manual clients

Static keys remain available for clients that need an explicit Authorization header or for controlled developer testing. As a Timeline team admin, open [Manage Timeline MCP endpoint](https://thetimeline.cc/app/team/mcp-share), create a key, and copy its one-time plaintext. Read it silently into the terminal that will launch the client:

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

A default key exposes only team-visible retrieval. Private and specific-user events remain unavailable because the key represents the team, not a member. The optional **Allow Timeline agent** key setting adds `agent:ask`; it enables paid, stateless agent turns that may call enabled team-shared custom MCP tools and create proposals for human review, but it does not grant direct canonical writes. Third-party MCP tools may have their own external side effects.

Keep the key in an environment variable; do not paste it into agent chats, repository files, or shell command arguments. Some clients require the header in local JSON. Treat that file as a secret, keep it out of repositories and shared folders, and follow the client's secure credential-storage guidance.

## Self-hosted Timeline

The bundled plugin connection targets the hosted service. For a self-hosted deployment, install the standalone skill and replace the URL in the direct MCP command with:

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

- [`timeline`](./timeline/SKILL.md) — route workspace questions to the relevant Timeline MCP tools, expand material evidence, and answer with citations and explicit uncertainty.
