# Custom MCP servers (inbound)

Bring tools from any MCP-compatible server into the agent's toolset. Visit **Connections → Agent tools** on `/app/connections/agent-tools` (team catalog — admins add custom servers) or `/app/me/mcp-servers` (personal overlay — visible only to you, any member can add). MCP servers are queried on demand during chat; they are not passive ingestion jobs. Successful team-server results are captured as immutable team-visible `source='integration'`, `provider='mcp'` evidence. Personal-server results remain private to their owner. Captured results include an event citation for the current answer and later reconciliation. Pick an auth mode:

Hosted catalog entries use production-safe HTTPS endpoints. Local-only MCP entries such as the Figma desktop server appear under **Coming soon** on Connections and do not offer a Connect action. Their loopback endpoints are not production-connectable.

- **None** — public MCP servers with no auth.
- **Bearer token** — API keys / personal access tokens.
- **Custom header** — arbitrary header name + value.
- **OAuth** — server speaks the MCP OAuth dance; state JWT-equivalent is HS256-signed with `AUTH_SECRET` (no extra env var). Access tokens auto-refresh on expiry; if refresh fails the chat inline-renders a *Reconnect* button.

Discovered tools appear under the server with a *Test call* button (admin for team servers, owner for personal). Tools are namespaced as `mcp__<serverIdCompact>__<toolName>` and merged into the agent's toolset on every `/api/chat` request. Outputs are fenced through `fenceExternalContent` so the agent treats them as untrusted data per Rule 8 of the system prompt. A background `mcp-health` worker pings every enabled server on a daily per-server schedule with 1, 2, 4, 8, then 24-hour failure backoff and surfaces `last_connected_at` / `last_error` in the UI.

<span id="timeline-as-mcp"></span>

Shared prerequisites, health and resync: [integrations](integrations.md).
