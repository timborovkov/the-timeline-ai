import { readFileSync } from 'node:fs';

import { expect } from '@timeline/test-support';
import { describe, it } from 'bun:test';

describe('legacy compare redirects', () => {
  it('keeps the retired works-with compare URLs as permanent redirects', () => {
    const route = readFileSync(new URL('./[slug]/page.tsx', import.meta.url), 'utf8');
    const content = readFileSync(
      new URL('../../components/marketing/compare/content.ts', import.meta.url),
      'utf8',
    );

    expect(content).toContain("hubspot: '/integrations/hubspot'");
    expect(content).toContain("jira: '/integrations/jira'");
    expect(content).toContain("linear: '/integrations/linear'");
    expect(content).toContain("notion: '/integrations/notion'");
    expect(route).toContain('LEGACY_COMPARE_REDIRECTS');
    expect(route).toContain('permanentRedirect');
  });
});
