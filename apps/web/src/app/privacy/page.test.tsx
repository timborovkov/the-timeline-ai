import { expect } from '@timeline/test-support';
import { vi } from '@timeline/test-support';
import { describe, it } from 'bun:test';
await vi.mock(
  import.meta.resolve('@/components/legal-page'),
  () => ({
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
  }),
  () => import('@/components/legal-page'),
);

const { renderToStaticMarkup } = await import('react-dom/server');
const { default: PrivacyPage } = await import('@/app/privacy/page');

describe('Privacy Policy analytics disclosures', () => {
  it('separates policy acknowledgement, public-browser consent, and personless counting', () => {
    const html = renderToStaticMarkup(<PrivacyPage />);

    expect(html).toContain('Policy acknowledgement, account creation, and necessary storage');
    expect(html).toContain('does not run in protected workspace routes');
    expect(html).toContain('no PostHog browser event');
    expect(html).toContain('one non-visitor stream identifier');
    expect(html).toContain('cannot recognize a returning visitor or account');
    expect(html).toContain('Sentry error monitoring');
    expect(html).toContain('href="/cookies"');
    expect(html).toContain('href="/trust"');
    expect(html).toContain('reviewed public page paths and referring website origins');
    expect(html).toContain('without query strings, fragments, page titles, or referrer paths');
  });

  it('explains the legacy tracker without implying historical deletion', () => {
    const html = renderToStaticMarkup(<PrivacyPage />);

    expect(html).toContain('previous source version loaded a Convex-hosted page tracker');
    expect(html).toContain('current source removes that script');
    expect(html).toContain('does not establish deletion of data previously received');
    expect(html).toContain('does not promise a shorter provider retention period');
    expect(html).toContain('do not use behavioral advertising trackers');
  });

  it('distinguishes staff and hosting policies from application controls', () => {
    const html = renderToStaticMarkup(<PrivacyPage />);

    expect(html).toContain('staff access policy prohibits routine browsing');
    expect(html).toContain('The policy requires access limited to what the task needs');
    expect(html).toContain('Our hosting policy requires encrypted external transport');
    expect(html).toContain('not confirmation of completed provider deletion');
    expect(html).not.toMatch(
      /evidence remains pending|evidence pending|before this version is published|deployment evidence must|audit evidence are still/,
    );
  });

  it('discloses member-authorized MCP and AI-app data sharing', () => {
    const html = renderToStaticMarkup(<PrivacyPage />);

    expect(html).toContain('Authorized-app data');
    expect(html).toContain('one selected team');
    expect(html).toContain('authorizing member&#x27;s private content');
    expect(html).toContain('content shared specifically with that member');
    expect(html).toContain('agent:ask');
    expect(html).toContain('external side effects');
    expect(html).toContain('own terms and privacy policy');
    expect(html).toContain('does not delete copies the app already received');
    expect(html).toContain('digests instead of plaintext');
    expect(html).toContain('records do not allow the app to regain access');
  });
});
