import { existsSync, readFileSync } from 'node:fs';

import { expect } from '@timeline/test-support';
import { describe, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { AgentSetupCard } from '@/components/marketing/agents/agent-setup-card';
import { TIMELINE_AGENT_SETUP_COMMAND } from '@/components/marketing/copy';

const styles = readFileSync(new URL('./agent-setup-card.module.css', import.meta.url), 'utf8');

describe('AgentSetupCard', () => {
  it('renders official agent marks on white tiles in one nowrap row', () => {
    const html = renderToStaticMarkup(<AgentSetupCard />);

    expect(html).toContain('Paste this line into your agent.');
    expect(html).not.toContain('Paste the line into Claude');
    expect(html).not.toContain('>Cu<');
    expect(html).not.toContain('>C<');
    expect(html).toContain('/connectors/claude.svg');
    expect(html).toContain('/connectors/openai.svg');
    expect(html).toContain('/connectors/cursor.svg');
    expect(html).toContain('/connectors/xai.svg');
    expect(html).toContain('/connectors/openclaw.svg');
    expect(html).toContain('/connectors/hermes.png');
    expect(html).toContain('bg-white');
    expect(html).toContain('rounded-sm');
    expect(html).toContain('border-border');
    expect(html).toContain(TIMELINE_AGENT_SETUP_COMMAND);
    expect(html.match(/bg-white/g)?.length).toBe(6);

    for (const file of [
      'claude.svg',
      'openai.svg',
      'cursor.svg',
      'xai.svg',
      'openclaw.svg',
      'hermes.png',
    ]) {
      expect(existsSync(new URL(`../../../../public/connectors/${file}`, import.meta.url))).toBe(
        true,
      );
    }
  });

  it('keeps the logo row on one line and the 0.75rem type floor', () => {
    expect(styles).toMatch(/\.marks\s*\{[^}]*flex-wrap:\s*nowrap;/s);
    expect(styles).not.toMatch(/\.marks\s*\{[^}]*flex-wrap:\s*wrap;/s);
    expect(styles).toContain('white-space: nowrap');

    const remFontSizeMinimums = [...styles.matchAll(/font-size:\s*(?:clamp\()?([\d.]+)rem/g)].map(
      ([, size]) => Number(size),
    );
    expect(Math.min(...remFontSizeMinimums)).toBeGreaterThanOrEqual(0.75);
  });
});
