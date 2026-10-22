import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type { ReactNode } from 'react';

vi.mock('@/components/legal-page', () => ({
  LegalPage: ({
    children,
    eyebrow,
    title,
  }: {
    children: ReactNode;
    eyebrow: string;
    title: string;
  }) => (
    <main>
      <p>{eyebrow}</p>
      <h1>{title}</h1>
      {children}
    </main>
  ),
}));
vi.mock('@/lib/public-metadata', () => ({ publicMetadata: () => ({}) }));

const { default: PrivacyPage } = await import('@/app/privacy/page');

describe('Privacy Policy', () => {
  it('discloses member-authorized MCP and AI-app data sharing', () => {
    const html = renderToStaticMarkup(<PrivacyPage />);

    expect(html).toContain('Version 2026-08-26 · Effective August 26, 2026');
    expect(html).toContain('Authorized-app data');
    expect(html).toContain('one selected team');
    expect(html).toContain('authorizing member&#x27;s private content');
    expect(html).toContain('content shared specifically with that member');
    expect(html).toContain('agent:ask');
    expect(html).toContain('external side effects');
    expect(html).toContain('own terms and privacy policy');
    expect(html).toContain('does not delete copies the app already received');
    expect(html).toContain('digests instead of plaintext authorization codes');
    expect(html).toContain('records do not allow the app to regain access');
    expect(html).toContain('href="/help/support"');
    expect(html).not.toContain('not configured');
  });
});
