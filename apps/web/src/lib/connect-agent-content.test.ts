import { expect } from '@timeline/test-support';
import { describe, it } from 'bun:test';

import {
  CONNECT_AGENT_SETUP_PROMPT,
  CONNECT_AGENT_SKILL_MARKDOWN,
  TIMELINE_MCP_TOOLS,
  chatGptConnectorDetails,
  connectAgentTeamPrompt,
  cursorMcpInstallUrl,
  ingestWebhookCurlExample,
  mcpScopeLabel,
} from '@/lib/connect-agent-content';

describe('connect-agent content', () => {
  it('keeps the public setup prompt and team email variant', () => {
    expect(CONNECT_AGENT_SETUP_PROMPT).toBe(
      'Set up The Timeline - https://thetimeline.cc/llms.txt',
    );
    expect(connectAgentTeamPrompt(null)).toBe(CONNECT_AGENT_SETUP_PROMPT);
    expect(connectAgentTeamPrompt('acme@inbound.thetimeline.cc')).toContain(
      'Team email: acme@inbound.thetimeline.cc',
    );
  });

  it('uses the five timeline.* tools and capture for remember', () => {
    expect(TIMELINE_MCP_TOOLS).toEqual([
      'timeline.search',
      'timeline.get',
      'timeline.subject',
      'timeline.ask',
      'timeline.remember',
    ]);
    expect(CONNECT_AGENT_SKILL_MARKDOWN).toContain('timeline.search');
    expect(CONNECT_AGENT_SKILL_MARKDOWN).toContain('timeline.remember');
    expect(CONNECT_AGENT_SKILL_MARKDOWN).toContain('capture');
    expect(CONNECT_AGENT_SKILL_MARKDOWN).not.toContain('timeline.ask_agent');
    expect(mcpScopeLabel('capture')).toBe('Remember');
  });

  it('builds the Cursor MCP install deeplink', () => {
    const href = cursorMcpInstallUrl('https://thetimeline.cc/api/mcp/server');
    expect(href.startsWith('cursor://anysphere.cursor-deeplink/mcp/install?')).toBe(true);
    expect(href).toContain('name=timeline');
    expect(href).toContain('config=');
  });

  it('does not mention Developer Mode in ChatGPT setup', () => {
    expect(chatGptConnectorDetails('https://thetimeline.cc/api/mcp/server')).toContain(
      'Settings → Apps',
    );
    expect(chatGptConnectorDetails('https://thetimeline.cc/api/mcp/server')).not.toContain(
      'Developer Mode',
    );
  });

  it('shows a one-shot ingest curl example', () => {
    expect(ingestWebhookCurlExample('https://thetimeline.cc/api/webhooks/ingest/token')).toContain(
      'curl -X POST https://thetimeline.cc/api/webhooks/ingest/token',
    );
  });
});
