import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/components/legal-page', () => ({
  LegalPage: ({
    children,
    description,
    title,
  }: {
    children: React.ReactNode;
    description: string;
    title: string;
  }) => (
    <main>
      <h1>{title}</h1>
      <p>{description}</p>
      {children}
    </main>
  ),
}));

import PrivacyPage from '@/app/privacy/page';

describe('Privacy Policy analytics disclosures', () => {
  it('states the role-based ZDR boundary and voice-transcription quality exception', () => {
    const html = renderToStaticMarkup(<PrivacyPage />);

    expect(html).toContain('Model privacy policy 2026-08-21.1');
    expect(html).toContain('openai/gpt-4o-transcribe');
    expect(html).toContain('quality-preserving exception');
    expect(html).toContain('up to 30 days');
    expect(html).toContain('fail closed instead of falling back');
    expect(html).not.toContain('zero data retention across every model group');
  });

  it('separates policy acknowledgement, public-browser consent, and aggregate counting', () => {
    const html = renderToStaticMarkup(<PrivacyPage />);

    expect(html).toContain('Policy acknowledgement, account creation, and necessary storage');
    expect(html).toContain('never in protected workspace routes');
    expect(html).toContain('no PostHog browser event');
    expect(html).toContain('identifier-free aggregate server counter');
    expect(html).toContain('Sentry error monitoring');
    expect(html).toContain('not claimed as deployed today');
    expect(html).toContain('href="/cookies"');
    expect(html).toContain('href="/trust"');
  });

  it('discloses the current protected-route integration and blocks stronger claims', () => {
    const html = renderToStaticMarkup(<PrivacyPage />);

    expect(html).toContain('conditional protected-route browser integration');
    expect(html).toContain('legacy Convex-hosted page tracker');
    expect(html).toContain('before this privacy worktree can be released');
    expect(html).toContain('use cookie and local-storage persistence');
    expect(html).toContain('must remain unset');
    expect(html).toContain('Project region, retention, DPA, deletion, access, IP handling');
  });
});
