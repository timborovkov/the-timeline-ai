# Timeline agent plugin

This directory packages the hosted Timeline MCP connection and the canonical `timeline` skill for Codex and Claude Code.

| Host | Repository catalogue | Plugin manifest |
| --- | --- | --- |
| Codex | `.agents/plugins/marketplace.json` at the repository root | `.codex-plugin/plugin.json` here |
| Claude Code | `.claude-plugin/marketplace.json` at the repository root | `.claude-plugin/plugin.json` here |

The catalogues locate the plugin; the nested manifests define it. They are not duplicate configuration.

[Installation and updates](skills/README.md) owns client setup. [The skill](skills/timeline/SKILL.md) owns agent behavior and is also served by the application; keep that single source. [Hosted MCP setup](../../docs/setup/timeline-mcp.md) owns server configuration; [directory publication](../../docs/marketplace-submissions.md) owns external submissions. Repository packaging is not provider approval or a public listing.

Never add a static Authorization header or secret to a manifest. Compatible hosts use the member OAuth consent flow; static keys belong only in private manual client configuration.
