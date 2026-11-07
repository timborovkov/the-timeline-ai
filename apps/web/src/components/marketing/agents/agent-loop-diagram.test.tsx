import { readFileSync } from 'node:fs';

import { expect } from '@timeline/test-support';
import { describe, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { AgentLoopDiagram } from '@/components/marketing/agents/agent-loop-diagram';
import { FICTIONAL_EXAMPLE_LABEL } from '@/components/marketing/copy';

const styles = readFileSync(new URL('./agent-loop-diagram.module.css', import.meta.url), 'utf8');

describe('AgentLoopDiagram', () => {
  it('shows write-in and MCP read-out without inventing native sync', () => {
    const html = renderToStaticMarkup(<AgentLoopDiagram />);

    expect(html).toContain('data-agent-loop');
    expect(html).toContain('Agents write into Timeline');
    expect(html).toContain('Agents read Timeline over MCP');
    expect(html).toContain('timeline.remember');
    expect(html).toContain('timeline.search');
    expect(html).toContain('https://thetimeline.cc/api/mcp/server');
    expect(html).toContain('Claude');
    expect(html).toContain('ChatGPT');
    expect(html).toContain('Cursor');
    expect(html).toContain('Grok');
    expect(html).toContain(FICTIONAL_EXAMPLE_LABEL);
    expect(html).not.toMatch(/WhatsApp|Slack Connect/iu);
  });

  it('keeps animated provenance properties to transforms and opacity', () => {
    expect(styles).toContain('@media (prefers-reduced-motion: no-preference)');
    expect(styles).toContain('transform: scaleX(0)');
    expect(styles).toContain('transform: scaleY(0)');
    expect(styles).toContain('opacity: 0.72');
    expect(styles).not.toMatch(/@keyframes[\s\S]*box-shadow:/u);
  });
});
