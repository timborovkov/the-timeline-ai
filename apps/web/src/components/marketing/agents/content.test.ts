import { expect } from '@timeline/test-support';
import { describe, it } from 'bun:test';

import { AGENTS_HUB } from '@/components/marketing/agents/content';
import { AGENT_SETUP_CARD, TIMELINE_AGENT_SETUP_COMMAND } from '@/components/marketing/copy';
import { TIMELINE_HOSTED_MCP_TOOLS } from '@/lib/agent-install-content';

describe('agents marketing copy', () => {
  it('keeps the confirmed setup-card title and body', () => {
    expect(AGENT_SETUP_CARD.kicker).toBe('For agents');
    expect(AGENT_SETUP_CARD.title).toBe('Give your agents the context to pick up work.');
    expect(AGENT_SETUP_CARD.body).toBe(
      'Agents can read permitted workspace context and record their progress as attributed notes.',
    );
    expect(TIMELINE_AGENT_SETUP_COMMAND).toBe(
      'Set up The Timeline - https://thetimeline.cc/llms.txt',
    );
  });

  it('teaches both write and read paths without inventing product', () => {
    const copy = JSON.stringify({ card: AGENT_SETUP_CARD, hub: AGENTS_HUB });

    expect(AGENTS_HUB.reportIn.paths.map((path) => path.name)).toEqual([
      'timeline.remember',
      'Ingest email',
      'Ingest webhook',
    ]);
    for (const tool of TIMELINE_HOSTED_MCP_TOOLS) {
      expect(AGENTS_HUB.readOut.toolsIntro).toContain(tool);
    }
    expect(copy).toContain('attributed evidence');
    expect(copy).toContain('does not change canonical records');
    expect(copy).toContain('tli_');
    expect(copy).toContain('one-time URL');
    expect(copy).toContain('agent:ask');
    expect(copy).not.toMatch(/WhatsApp|Slack Connect|Teams chat/iu);
    expect(copy).not.toMatch(/\bweekly\b/iu);
    expect(copy).not.toMatch(/structured memory/iu);
    expect(copy).not.toContain('Garry Tan');
    expect(AGENTS_HUB.setupPrerequisite.body).toContain('name your team on Welcome');
    expect(AGENTS_HUB.setupPrerequisite.body).toContain('choose your team');
    expect(AGENTS_HUB.setupPrerequisite.distinction).toContain('external agent');
    expect(AGENTS_HUB.setupPrerequisite.distinction).toContain(
      'does not add third-party tools to The Timeline Agent',
    );
    expect(AGENTS_HUB.setupPrerequisite.mcpHref).toBe('/integrations/mcp');
  });

  it('keeps attributed staging evidence separate from customer verification', () => {
    expect(AGENTS_HUB.example.label).toBe('Example');
    expect(AGENTS_HUB.example.title).toContain('An agent');
    expect(AGENTS_HUB.example.boundary).toContain('customer outcome still needs verification');
    expect(AGENT_SETUP_CARD.title).not.toContain('Grok');
    expect(AGENT_SETUP_CARD.body).not.toContain('Grok');
    expect(AGENTS_HUB.title).not.toContain('Grok');
    expect(AGENTS_HUB.summary).not.toContain('Grok');
  });
});
