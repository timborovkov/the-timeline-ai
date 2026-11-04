import { readFileSync } from 'node:fs';

import { expect } from '@timeline/test-support';
import { describe, it } from 'bun:test';

describe('legacy solution redirects', () => {
  it('keeps the retired weekly and CRM solution URLs as permanent redirects', () => {
    const source = readFileSync(new URL('./[slug]/page.tsx', import.meta.url), 'utf8');

    expect(source).toContain("'weekly-project-updates': USE_CASE_ROUTES.teamDailyLog");
    expect(source).toContain("'crm-context-from-team-activity': USE_CASE_ROUTES.crm");
    expect(source).toContain('permanentRedirect');
  });
});
