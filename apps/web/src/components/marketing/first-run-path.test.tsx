import { expect } from '@timeline/test-support';
import { describe, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { FIRST_RUN_NOTE, FIRST_RUN_STEPS } from '@/components/marketing/copy';
import { FirstRunPath } from '@/components/marketing/first-run-path';

describe('FirstRunPath', () => {
  it('states the real first-run sequence without requiring every connector', () => {
    const html = renderToStaticMarkup(<FirstRunPath />);

    expect(html).toContain('data-first-run="full"');
    for (const step of FIRST_RUN_STEPS) {
      expect(html).toContain(step.title);
      expect(html).toContain(step.detail);
    }
    expect(html).toContain(FIRST_RUN_NOTE);
    expect(html).toContain('Slack channel');
    expect(html).toContain('Telegram group');
    expect(html).toContain('direct chat');
    expect(html).toContain('Plain-text questions');
    expect(html).toContain('explicit notes and supported media can still be captured');
    expect(html).not.toContain('it does not capture');
    expect(html).toContain('You do not need every connector.');
    expect(html).not.toMatch(/all integrations|minutes to set up|install every/iu);
  });

  it('hides supporting detail in the compact pricing card', () => {
    const html = renderToStaticMarkup(<FirstRunPath compact />);

    expect(html).toContain('data-first-run="compact"');
    expect(html).toContain(FIRST_RUN_STEPS[0].title);
    expect(html).toContain(FIRST_RUN_NOTE);
  });
});
