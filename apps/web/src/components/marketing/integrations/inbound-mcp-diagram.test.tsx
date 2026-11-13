import { readFileSync } from 'node:fs';

import { expect } from '@timeline/test-support';
import { describe, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { InboundMcpDiagram } from '@/components/marketing/integrations/inbound-mcp-diagram';
import { MCP_GUIDE_HOSTED_TOOL_NAMES } from '@/components/marketing/integrations/mcp-guide-content';

const styles = readFileSync(new URL('./inbound-mcp-diagram.module.css', import.meta.url), 'utf8');

describe('InboundMcpDiagram', () => {
  it('shows Timeline Agent live lookup without external-agent write-in or read-out', () => {
    const html = renderToStaticMarkup(<InboundMcpDiagram />);

    expect(html).toContain('data-inbound-mcp');
    expect(html).toContain('The Timeline Agent');
    expect(html).toContain('Live lookup');
    expect(html).toContain('Connected MCP tools');
    expect(html).not.toContain('Fictional example');
    for (const name of MCP_GUIDE_HOSTED_TOOL_NAMES) {
      expect(html).toContain(name);
    }
    expect(html).not.toContain('data-agent-loop');
    expect(html).not.toContain('Agents write into Timeline');
    expect(html).not.toContain('Remember a note');
    expect(html).not.toMatch(/Claude|ChatGPT|Cursor|Grok/u);
    expect(html).not.toMatch(/tli_|timeline\.remember/u);
  });

  it('keeps animated provenance properties to transforms and opacity', () => {
    expect(styles).toContain('@media (prefers-reduced-motion: no-preference)');
    expect(styles).toContain('transform: scaleX(0)');
    expect(styles).toContain('transform: scaleY(0)');
    expect(styles).toContain('opacity: 1');
    expect(styles).not.toContain('infinite');
    expect(styles).not.toMatch(/@keyframes[\s\S]*box-shadow:/u);
  });
});
