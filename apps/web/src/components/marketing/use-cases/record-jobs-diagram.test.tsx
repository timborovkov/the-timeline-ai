import { readFileSync } from 'node:fs';

import { expect } from '@timeline/test-support';
import { describe, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { USE_CASES } from '@/components/marketing/use-cases/content';
import { RecordJobsDiagram } from '@/components/marketing/use-cases/record-jobs-diagram';

const styles = readFileSync(new URL('./record-jobs-diagram.module.css', import.meta.url), 'utf8');

describe('RecordJobsDiagram', () => {
  it('maps conversations through one work record to the six public jobs', () => {
    const html = renderToStaticMarkup(<RecordJobsDiagram />);

    expect(html).toContain('data-record-jobs');
    expect(html).toContain('Conversations');
    expect(html).toContain('Work record');
    expect(html).toContain('Slack');
    expect(html).toContain('Telegram');
    for (const useCase of USE_CASES) {
      expect(html).toContain(`href="${useCase.route}"`);
      expect(html).toContain(useCase.cardTitle);
    }
  });

  it('keeps animated provenance properties to transforms only', () => {
    expect(styles).toContain('@media (prefers-reduced-motion: no-preference)');
    expect(styles).toContain('transform: scaleX(0)');
    expect(styles).toContain('transform: scaleY(0)');
    expect(styles).not.toMatch(/@keyframes[\s\S]*box-shadow:/u);
    expect(styles).not.toMatch(/@keyframes[\s\S]*opacity:/u);
  });
});
