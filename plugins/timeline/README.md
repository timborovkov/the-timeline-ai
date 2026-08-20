# The Timeline plugin

This plugin connects Codex to the hosted Timeline MCP endpoint and adds one general `timeline` skill. The skill teaches agents how to choose the relevant Timeline tools, expand material evidence, distinguish current state from activity, and cite consequential claims. It adapts that shared approach to search, status updates, incident analysis, and other workspace questions.

The bundled MCP connection is read-only by default and sends `TIMELINE_MCP_KEY` as a bearer token. Timeline administrators can separately opt a key into paid, proposal-only `timeline.ask_agent` access; the bundled skill does not require that scope. Agent-enabled keys may call enabled team-shared custom MCP tools, whose third-party actions can have external side effects.

See the [skill installation guide](./skills/README.md) for plugin installation, standalone skill installation, direct MCP setup, updates, and self-hosted configuration.

The plugin intentionally has no `.app.json`. Timeline currently authenticates its outbound MCP endpoint with static bearer keys, while a first-class ChatGPT app connection requires an OAuth-compatible path or bridge.
