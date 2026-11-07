import { CANONICAL_PUBLIC_ORIGIN } from '@/lib/site-url';

export function buildAgentProvisioningMarkdown(): string {
  return `# Provision a Timeline workspace

Use this API only when a verified existing workspace owner has delegated new-workspace creation. A brand-new customer must first establish their own account, verify identity, and accept the terms in the browser.

## Authorize once

The owner opens Account → Agent provisioning, names a grant, chooses its workspace allowance (default 1, maximum 10), expiry (default 7 days, maximum 30), and whether new agent connections can capture notes. Store the one-time tlp_ credential in the client's secret store. Never paste credentials in chat or commit them to a repository.

## Create

POST ${CANONICAL_PUBLIC_ORIGIN}/api/agent/workspaces
Authorization: Bearer <provisioning credential from secret storage>
Idempotency-Key: <stable unique key for this workspace request>
Content-Type: application/json

Body: {"name":"Project workspace","timezone":"Europe/London","agentName":"Project coworker"}

Only these fields are accepted. Use an IANA timezone. The idempotency key is 1–128 letters, digits, dots, underscores, colons or hyphens. Requests are limited to five attempts per owner per hour.

The response contains workspace identity, mcpEndpoint, connection identity/scopes, credential (a team-visible MCP key), and billing restriction status. Store credential securely and configure a client supporting bearer-authenticated Streamable HTTP. Do not print either credential. The provisioning token cannot authenticate MCP, access existing teams, create customers, activate paid plans, or grant agent:ask.

## Retries and restrictions

Reuse the same idempotency key and body after a network failure. Matching retries recover the same response for fifteen minutes; changed payloads return 409 idempotency_conflict. After the receipt expires, 409 receipt_expired_reconnect_in_timeline means the owner must recover connection access in Timeline. Never use a new key merely to recover a lost response: that would create another workspace.

401 means the credential is invalid, expired, or revoked. 403 identifies missing verified ownership or an exhausted allowance. 429 requires waiting for the owner-wide hourly limit. 400 means invalid input. No error should be treated as permission to bypass limits.

Existing Free eligibility applies; additional workspaces can be restricted. A restricted billing result does not authorize buying a plan. The owner handles billing in Timeline.

Revoking the provisioning grant prevents future creation. Existing workspaces and their MCP connections remain separately managed.

## Start working

Call timeline.get with kind="connection" to verify the intended team and effective reporting preference. New workspaces start with on-request reporting. Ask the owner to choose a scoped ongoing reporting agreement in Connect your agent if desired. Follow [setup](${CANONICAL_PUBLIC_ORIGIN}/agents/setup.md) for the first useful contribution and [the skill](${CANONICAL_PUBLIC_ORIGIN}/agents/SKILL.md) for ongoing work.
`;
}
