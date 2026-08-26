import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const rootLayout = readFileSync(new URL('./layout.tsx', import.meta.url), 'utf8');
const publicShell = readFileSync(
  new URL('../components/public-shell.tsx', import.meta.url),
  'utf8',
);

describe('root layout analytics boundary', () => {
  it('keeps the global script allowlist limited to the reviewed inline preference bootstrap', () => {
    expect(rootLayout.match(/<Script\b/g)).toHaveLength(1);
    expect(rootLayout).toContain('<Script id="sidebar-preference"');
    expect(rootLayout).not.toMatch(/<Script\b[^>]*\bsrc=/);
    expect(rootLayout).not.toContain('convex.site/api/a/');
  });

  it('keeps one analytics lifecycle boundary across public and private route transitions', () => {
    expect(rootLayout).toContain('<PublicAnalyticsBoundary>{children}</PublicAnalyticsBoundary>');
    expect(publicShell).toContain('<CookieSettingsButton />');
    expect(publicShell).not.toContain('<PublicAnalyticsBoundary>');
  });
});
