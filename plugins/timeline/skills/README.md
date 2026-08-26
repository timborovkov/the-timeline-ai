# Timeline agent skill

The `timeline` skill teaches agents how to use Timeline's team-visible MCP tools as cited workspace memory. Installing the plugin is the easiest route because it adds the skill and hosted MCP connection together.

## Install the plugin

1. Add this repository as a sparse marketplace and install the plugin:

   ```bash
   codex plugin marketplace add timborovkov/the-timeline-ai \
     --ref main \
     --sparse .agents/plugins \
     --sparse plugins/timeline
   codex plugin add timeline@timeline
   ```

2. As a Timeline team admin, open [Manage Timeline MCP endpoint](https://thetimeline.cc/app/team/mcp-share), create a key, and copy the one-time plaintext. If you are not an admin, ask one to create the key for you.
3. For Codex CLI, read that key silently into the terminal you will use to launch Codex, so its plaintext does not enter shell history:

   ```bash
   printf 'Timeline MCP key: '
   IFS= read -r -s TIMELINE_MCP_KEY
   printf '\n'
   export TIMELINE_MCP_KEY
   ```

4. Fully exit the current Codex process, relaunch `codex` from that same terminal, and start a new task so the installed skills, MCP tools, and key are loaded. A new task cannot import an environment variable added after the Codex process started.

For the Codex app or IDE extension, which may not inherit shell variables, add the key to Codex's user-level environment file outside any repository:

```dotenv
TIMELINE_MCP_KEY=<one-time plaintext key>
```

Save that line in `~/.codex/.env`, restrict the file to your user account (for example, `chmod 600 ~/.codex/.env` on macOS or Linux), fully restart the app or extension, and then start a new task. See [OpenAI's Codex environment guidance](https://learn.chatgpt.com/docs/amazon-bedrock#desktop-app-and-ide-extension) for the current client-specific flow.

The plugin points to `https://thetimeline.cc/api/mcp/server`. Keep its key in an environment variable; do not paste it into agent chats, repository files, or shell command arguments. Some other MCP clients require an Authorization header in local JSON. Treat that file as a secret, keep it out of repositories and shared folders, and follow the client's secure credential-storage guidance.

## Install the standalone skill

Use this route when you want only the skill or when your Timeline is a separately licensed self-managed deployment. Paste this into Codex:

```text
$skill-installer Install this Timeline skill from GitHub:
- https://github.com/timborovkov/the-timeline-ai/tree/main/plugins/timeline/skills/timeline
```

Then start a new task. If the skill still does not appear, restart Codex and start another new task. The standalone skill still needs a Timeline MCP connection.

## Connect Timeline MCP

For hosted Timeline, the plugin configures this automatically. To connect MCP without the plugin:

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

Use Streamable HTTP, not legacy SSE. A default key exposes only team-visible retrieval. Private and specific-user events remain unavailable. The optional **Allow Timeline agent** scope enables paid, stateless agent turns that may call enabled team-shared custom MCP tools and create proposals for human review; it does not grant direct canonical writes. Third-party MCP tools may have their own external side effects.

## Separately licensed self-managed Timeline

The bundled plugin connection targets the hosted service. For a separately licensed self-managed deployment, install the standalone skill and replace the URL in the direct MCP command with:

```text
https://<your-timeline-origin>/api/mcp/server
```

## Update

Refresh the marketplace, reinstall the plugin, and then start a new task. Restart Codex if the refreshed plugin still does not appear:

```bash
codex plugin marketplace upgrade timeline
codex plugin add timeline@timeline
```

## Included skill

- [`timeline`](./timeline/SKILL.md) — route workspace questions to the relevant Timeline MCP tools, expand material evidence, and answer with citations and explicit uncertainty.
