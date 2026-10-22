# The Timeline agent plugin

This directory packages the same hosted Timeline MCP connection and general `timeline` skill for Codex and Claude Code. The skill teaches agents how to choose the relevant Timeline tools, expand material evidence, distinguish current state from activity, and cite consequential claims across search, status updates, incident analysis, and other workspace questions.

The bundled MCP definitions contain the hosted URL without a static Authorization header. Once the corresponding server release is deployed, compatible hosts therefore use Timeline's OAuth discovery and consent flow: the member signs in, chooses a team, and approves the default `read` scope. A client may additionally request `agent:ask` for paid, proposal-only Timeline agent turns. Only a current team owner or admin can grant that optional scope, and demotion invalidates it. It may call enabled team-shared custom MCP tools with external side effects, but it does not allow direct canonical Timeline writes.

Static `tla_` bearer keys remain available for direct, manual, and developer-client configuration. They represent a team rather than a member and can read only team-visible evidence. Keep them out of plugin manifests, repositories, chats, and shared configuration.

Repository packaging exists for both hosts:

- `.agents/plugins/marketplace.json` and `.codex-plugin/plugin.json` package the Codex plugin.
- `.claude-plugin/marketplace.json` and `.claude-plugin/plugin.json` package the Claude Code plugin.

See the [installation guide](./skills/README.md) for Codex and Claude Code installation, OAuth sign-in, standalone skill installation, direct MCP setup, updates, and self-hosted configuration.

These repository packages are installable directly, but that is not the same as provider review or publication. OpenAI now uses one universal Plugins Directory across ChatGPT and Codex. Timeline's OpenAI draft must use **With MCP** and submit the production remote MCP connection together with the Timeline skill; neither repository manifest is itself an OpenAI submission. Claude Code can install this repository marketplace directly, while Anthropic's public Claude plugin marketplace and the separate Claude.ai Connectors Directory require their own submission and review steps. Production migration, deployment, smoke testing, provider submission, review, and publication remain external release work.
