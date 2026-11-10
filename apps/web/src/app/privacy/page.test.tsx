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

  it('discloses Google Drive Limited Use, storage, deletion, and no general-model training', () => {
    const html = renderToStaticMarkup(<PrivacyPage />);

    expect(html).toContain('Google Drive');
    expect(html).toContain('https://www.googleapis.com/auth/drive.readonly');
    expect(html).toContain('Google API Services User Data Policy');
    expect(html).toContain('Limited Use requirements');
    expect(html).toContain('does not use Google user data to train general-purpose models');
    expect(html).toContain('Cited timeline events already captured stay in the workspace');
    expect(html).not.toContain('drive.metadata.readonly');
  });

  it('distinguishes personal disconnect, workspace-source removal, and captured-history deletion', () => {
    const html = renderToStaticMarkup(<PrivacyPage />);

    expect(html).toContain('Personal account or OAuth disconnect');
    expect(html).toContain('Workspace source removal');
    expect(html).toContain('Deletion of captured history or documents');
    expect(html).toContain('encrypted credentials stored for that connection');
    expect(html).toContain('Google Drive change watches and Monday.com webhooks');
    expect(html).toContain('are not uninstalled by this action');
    expect(html).toContain('cancels in-flight document extraction');
    expect(html).toContain('Captured source events remain immutable workspace evidence');
    expect(html).toContain('no complete self-serve erasure');
    expect(html).toContain('To request deletion of personal data');
    expect(html).toContain('href="/help/support"');
    expect(html).toContain('do not publish a deletion-completion SLA');
    expect(html).toContain('legal, billing, and tax records');
    expect(html).not.toContain(
      'Disconnecting a source stops future access but does not automatically erase',
    );
  });

  it('discloses Firecrawl as the first-run website-scan processor with evidenced claims only', () => {
    const html = renderToStaticMarkup(<PrivacyPage />);

    expect(html).toContain('Firecrawl (SideGuide Technologies, Inc.)');
    expect(html).toContain('public website URL a user submits');
    expect(html).toContain('up to five public pages');
    expect(html).toContain('United States');
    expect(html).toContain('24 hours after completion');
    expect(html).toContain('to be confirmed');
    expect(html).toContain('does not enable Firecrawl');
    expect(html).toContain('zero-data-retention');
    expect(html).toContain('href="https://www.firecrawl.dev/privacy-policy"');
    expect(html).toContain('href="https://docs.firecrawl.dev/security"');
    expect(html).not.toContain('Mendable');
    expect(html).not.toContain('zero data retention for website scan');
  });

  it('discloses evidenced Resend sending, inbound capture, tracking, and published policy', () => {
    const html = renderToStaticMarkup(<PrivacyPage />);

    expect(html).toContain('in.thetimeline.cc');
    expect(html).toContain('eu-west-1');
    expect(html).toContain('noreply@in.thetimeline.cc');
    expect(html).toContain('team invitations');
    expect(html).toContain('does not use Resend audiences, contacts, segments, broadcasts');
    expect(html).toContain('email.received');
    expect(html).toContain('https://thetimeline.cc/api/email/inbound');
    expect(html).toContain('Open tracking and click tracking are currently enabled');
    expect(html).toContain('does not set per-send tracking flags');
    expect(html).toContain('stored in the United States regardless of sending region');
    expect(html).toContain('href="https://resend.com/security/gdpr"');
    expect(html).toContain('href="https://resend.com/legal/dpa"');
    expect(html).toContain('href="https://resend.com/legal/subprocessors"');
    expect(html).toContain('does not by itself delete copies Resend holds');
    expect(html).toContain(
      'published retention window unless Resend is asked to delete them earlier',
    );
    expect(html).not.toContain('remain to be verified');
    expect(html).not.toContain('signed DPA');
    expect(html).not.toMatch(/tracking is (?:off|disabled)/i);
  });
});
