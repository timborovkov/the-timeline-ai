import { expect } from '@timeline/test-support';
import { vi } from '@timeline/test-support';
import { afterEach, beforeEach, describe, it } from 'bun:test';
// Test environment: happy-dom

const fakes = vi.hoisted(() => ({ listCatalog: vi.fn() }));

await vi.mock(
  import.meta.resolve('@timeline/shared/integrations/registry'),
  async () => ({
    ...(await import('@timeline/shared/integrations/registry')),
    listCatalog: fakes.listCatalog,
  }),
  () => import('@timeline/shared/integrations/registry'),
);

const { cleanup, render, screen } = await import('@testing-library/react');
const { default: userEvent } = await import('@testing-library/user-event');
const { renderToStaticMarkup } = await import('react-dom/server');

const { resetPublicSessionCache, setPublicSessionCache } = await import('@/lib/public-session');
const { getSiteUrl } = await import('@/lib/site-url');
const { default: LandingPage, metadata } = await import('@/app/(landing)/page');

describe('LandingPage', () => {
  afterEach(() => {
    cleanup();
    resetPublicSessionCache();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    fakes.listCatalog.mockReturnValue(
      ['GitHub', 'Linear', 'Google Drive', 'Monday.com', 'Slack', 'Sentry'].map((label, index) => ({
        kind: 'native',
        ingestStatus: 'implemented',
        label,
        status: index < 2 ? 'native_available' : 'native_unconfigured',
      })),
    );
  });

  it('server-renders the five-scene evidence narrative in order', () => {
    const html = renderToStaticMarkup(<LandingPage />);

    expect(html.match(/<footer\b/g)).toHaveLength(1);
    expect(html).toContain('aria-label="The Timeline home"');
    expect(html).toContain('https://github.com/timborovkov/the-timeline-ai');
    expect(html).toContain('aria-label="The Timeline source code on GitHub"');
    expect(html.match(/>Source on GitHub</g)).toHaveLength(1);
    expect(html).toContain('href="/cookies"');
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html).toContain('Your team&#x27;s work, <em>written down for you</em>');
    expect(html).toContain(
      'The Timeline updates itself from your team&#x27;s Slack or Telegram, email, calls and docs.',
    );

    const scenes = ['01-claim', '02-chronology', '03-answer', '04-trust', '05-cta'];
    let previousIndex = -1;
    for (const scene of scenes) {
      const sceneIndex = html.indexOf(`data-scene="${scene}"`);
      expect(sceneIndex).toBeGreaterThan(previousIndex);
      previousIndex = sceneIndex;
    }

    expect(html).toContain('Acme rollout / Last 7 days');
    expect(html).toContain(
      'aria-label="Work events stream from six sources into The Timeline, where the work record becomes a daily update and cited answers."',
    );
    expect(html).toContain('Fictional Acme example, not customer data.');
    expect(html).toContain('<details');
    expect(html).toContain('The Timeline');
    expect(html).toContain('Work record');
    expect(html).toContain('Daily update');
    expect(html).toContain('Cited answers');
    expect(html).not.toContain('How scattered work becomes useful context.');
    expect(html).not.toContain('Connected, not used in this answer');
    expect(html).not.toContain('Sentry is connected, but unused in this answer.');
    expect(html).toContain('Every claim inspectable');
    expect(html).not.toContain('5 of 6 sources used');
    expect(html).toContain('Telegram');
    expect(html).toContain('Linear');
    expect(html).toContain('Sentry');
    expect(html).toContain('/connectors/telegram.svg');
    expect(html).toContain('/connectors/google-meet.svg');
    expect(html.match(/data-hero-flow-path="ingest"/g)).toHaveLength(6);
    expect(html.match(/data-hero-flow-path="outcome"/g)).toHaveLength(1);
    expect(html.match(/data-hero-flow-packet="ingest"/g)).toHaveLength(6);
    expect(html.match(/data-hero-flow-packet="outcome"/g)).toHaveLength(1);
    expect(html).toContain('data-flow-motion');
    expect(html.match(/<animateMotion/g)).toHaveLength(7);
    expect(html).toContain('aria-label="Public navigation"');
    expect(html).toContain('href="/integrations"');
    expect(html).toContain('href="/how-it-works"');
    expect(html).toContain('aria-label="Public navigation menu"');
    expect(html).toContain('SSO blocks launch. Friday’s customer update is still due.');
    expect(html).toContain('Evidence behind this answer');
    expect(html).toContain('href="#acme-source-01"');
    expect(html).toContain('Source 01: Telegram group message');
    expect(html).toContain('Built for teams that run their work <em>through chat.</em>');
    expect(html).toContain('href="/use-cases/work-record"');
    expect(html).toContain('href="/use-cases/team-daily-log"');
    expect(html).toContain('href="/use-cases/crm"');
    expect(html).toContain('<a href="/use-cases/work-record"><span>01</span><h4>Work record</h4>');
    expect(html).toContain(
      '<a href="/use-cases/team-daily-log"><span>02</span><h4>Team daily log</h4>',
    );
    expect(html).toContain('<a href="/use-cases/crm"><span>04</span><h4>CRM</h4>');
    expect(html).toContain('Every answer carries its evidence chain.');
    expect(html).not.toContain('Northline');
    expect(html.match(/data-home-diagram/g)).toHaveLength(6);
    expect(html).not.toContain('data-home-ambient');
    expect(html).not.toContain('↘');
    expect(html).not.toContain('02-sources');
    expect(html).not.toContain('05-audience');
    expect(html).not.toContain('aria-hidden="true" data-home-root');

    const jsonLd = /<script type="application\/ld\+json">(.*?)<\/script>/.exec(html)?.[1];
    expect(jsonLd).toBeDefined();
    expect(jsonLd).toContain(`"url":"${getSiteUrl()}"`);
    const graph = JSON.parse(jsonLd ?? '{"@graph":[]}') as {
      '@graph': Record<string, unknown>[];
    };
    const webPage = graph['@graph'].find((node) => node['@type'] === 'WebPage');
    const application = graph['@graph'].find((node) => node['@type'] === 'SoftwareApplication');
    expect(webPage).toMatchObject({
      dateModified: '2026-11-03',
      lastReviewed: '2026-11-03',
    });
    expect(application?.featureList).toContain(
      'Native ingestion for GitHub, Linear, Google Drive, Monday.com, Slack, and Sentry',
    );
    expect(application?.featureList).toContain(
      'Human approval before inferred durable workspace changes',
    );
    expect(metadata).toMatchObject({
      title: "Your team's work, written down for you",
      description:
        'The Timeline keeps client, deal, task and decision records up to date from Slack, Telegram, email and calls. Every line has its source, and you approve each change.',
      alternates: { canonical: '/' },
      openGraph: {
        description:
          'The Timeline keeps client, deal, task and decision records up to date from Slack, Telegram, email and calls. Every line has its source, and you approve each change.',
      },
    });
  });

  it('states connector capabilities without inventing a connector destination', () => {
    const html = renderToStaticMarkup(<LandingPage />);

    for (const connector of ['GitHub', 'Linear', 'Google Drive', 'Monday.com', 'Slack', 'Sentry']) {
      expect(html).toContain(connector);
    }

    expect(html).toContain('Where evidence enters');
    expect(html).toContain('Two ways in. One cited record.');
    expect(html).toContain('Messages and files');
    expect(html).toContain('Send the work to Timeline.');
    expect(html).toContain('Connected tools');
    expect(html).toContain('Sync selected records.');
    expect(html).toContain('Setup and supported data');
    expect(html).not.toContain('Admin setup needed');
    expect(html).toContain('use enabled custom MCP tools when you ask a question');
    expect(html).not.toMatch(
      /Capture contract|Deliberate capture|Provider record sync|Available here|MCP is live approved access/u,
    );
    for (const surface of [
      'Telegram',
      'Slack conversations',
      'Email forwarding',
      'Meeting transcripts',
      'Ingest webhooks',
    ]) {
      expect(html).toContain(surface);
    }
    expect(html).not.toContain('Future connector pages remain unindexed');
    expect(html).toContain('href="/integrations"');
    for (const slug of ['github', 'linear', 'google-drive', 'monday', 'slack', 'sentry']) {
      expect(html).toContain(`href="/integrations/${slug}"`);
    }
  });

  it('renders the product, problem, workflow, and trust contract without implying passive capture', () => {
    const html = renderToStaticMarkup(<LandingPage />);

    expect(html).toContain(
      'The Timeline updates itself from your team&#x27;s Slack or Telegram, email, calls and docs.',
    );
    expect(html).toContain('Link one channel. <em>Watch the record fill in.</em>');
    expect(html).toContain(
      'Your team runs its work in Slack or Telegram, then spreads it across email, calls and documents.',
    );
    expect(html).toContain(
      'The Timeline keeps the record current from those conversations, with the source, time and visibility of every line.',
    );
    expect(html).toContain('Ask the question you normally answer by searching four tools');
    expect(html).toContain(
      'Give me the current status, handoff, blockers, and customer commitments.',
    );
    expect(html).toContain('proposes it for human review instead of applying it on its own');
    expect(html).toContain('Approval-backed suggestions');
    expect(html).toContain('Telegram / linked launch group');
    expect(html).toContain(
      'Link a Telegram group or Slack channel, forward mail, add a meeting transcript or file, or post an authenticated webhook event.',
    );
    expect(html).toContain('A direct chat asks the agent; it is not passive history capture.');
    expect(html).not.toContain('Connected, not used in this answer');
    expect(html).not.toContain('Sentry is connected, but unused in this answer.');
    expect(html).not.toContain('Timeline watches the tools');
    expect(html).not.toMatch(/captures? (?:all|every) (?:chat|conversation|message)/iu);
  });

  it('keeps signed-out calls to action on public pages or the real account conversion path', () => {
    const html = renderToStaticMarkup(<LandingPage />);

    expect(html.match(/href="\/sign-up"/g)).toHaveLength(3);
    expect(html).toContain('data-public-analytics-cta="try_project"');
    expect(html).toContain('data-public-analytics-cta="start_free"');
    expect(html).toContain('href="/product-tour"');
    expect(html).toContain('See it first');
    expect(html).toContain('data-public-analytics-cta="sign_in"');
    expect(html).toContain('data-public-analytics-cta="contact_support"');
    expect(html).toContain('href="/how-it-works"');
    expect(html).not.toContain('<video');
    expect(html).not.toMatch(/watch (?:the )?demo|interactive demo/iu);
    expect(html).not.toMatch(/href="(?:\/(?:app\/)?demo|\/workspace\/demo|https?:\/\/t\.me\/)/u);
    expect(html).not.toMatch(/href="\/(?:app\/)?(?:seed|acme)(?:\/|"|\?)/iu);
  });

  it('keeps the marketing page browsable for signed-in users with dashboard CTAs', () => {
    setPublicSessionCache({ status: 'signed-in' });
    render(<LandingPage />);

    expect(screen.getByRole('link', { name: 'Go to dashboard' }).getAttribute('href')).toBe('/app');
    expect(screen.getByRole('link', { name: 'Open your Timeline' }).getAttribute('href')).toBe(
      '/app',
    );
    expect(
      screen
        .getAllByRole('link', { name: 'Dashboard' })
        .every((link) => link.getAttribute('href') === '/app'),
    ).toBe(true);
    expect(
      screen
        .getAllByRole('link')
        .some((link) => link.getAttribute('data-public-analytics-cta') === 'open_dashboard'),
    ).toBe(true);
    expect(screen.queryByText('Create team')).toBeNull();
    expect(screen.queryByRole('link', { name: 'Sign in' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Try one real project' })).toBeNull();
  });

  it('moves keyboard focus to main when the landing skip link is activated', async () => {
    const user = userEvent.setup();

    render(<LandingPage />);

    const skipLink = screen.getByRole('link', { name: 'Skip to main content' });
    const main = screen.getByRole('main');
    skipLink.focus();

    await user.keyboard('{Enter}');

    expect(main.tabIndex).toBe(-1);
    expect(document.activeElement).toBe(main);
    expect(skipLink.className).toContain('focus:z-[90]');
  });
});
