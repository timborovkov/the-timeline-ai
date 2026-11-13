import { readFileSync } from 'node:fs';

import { expect } from '@timeline/test-support';
import { describe, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { AgentLoopDiagram } from '@/components/marketing/agents/agent-loop-diagram';

const styles = readFileSync(new URL('./agent-loop-diagram.module.css', import.meta.url), 'utf8');

describe('AgentLoopDiagram', () => {
  it('shows write-in and read-out without inbound MCP lookup or install noise', () => {
    const html = renderToStaticMarkup(<AgentLoopDiagram />);

    expect(html).toContain('data-agent-loop');
    expect(html).toContain('Agents write into Timeline');
    expect(html).toContain('Agents read Timeline');
    expect(html).toContain('Illustrative example');
    expect(html).toContain('A note adds evidence. Lasting record changes still wait for approval.');
    expect(html).toContain('Source attached');
    expect(html).not.toContain('data-inbound-mcp');
    expect(html).not.toMatch(/tli_|tla_|timeline\.remember|POST \/api/u);
    expect(html).not.toMatch(/Notion|Jira|Confluence|Stripe/u);
    expect(html).not.toMatch(/WhatsApp|Slack Connect/iu);
  });

  it('keeps animated provenance properties to transforms and opacity', () => {
    expect(styles).toContain('@media (prefers-reduced-motion: no-preference)');
    expect(styles).toContain('transform: scaleY(0)');
    expect(styles).toContain('opacity: 1');
    expect(styles).not.toContain('infinite');
    expect(styles).not.toMatch(/@keyframes[\s\S]*box-shadow:/u);
  });
});
