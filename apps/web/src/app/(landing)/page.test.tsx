import { expect } from '@timeline/test-support';
import { afterEach, describe, it } from 'bun:test';

// Test environment: happy-dom

const { cleanup, render, screen } = await import('@testing-library/react');
const { default: userEvent } = await import('@testing-library/user-event');
const { renderToStaticMarkup } = await import('react-dom/server');

const { resetPublicSessionCache, setPublicSessionCache } = await import('@/lib/public-session');
const { getSiteUrl } = await import('@/lib/site-url');
const { PUBLIC_DEMO_STORY } = await import('@/components/marketing/public-demo-story');
const { default: LandingPage, metadata } = await import('@/app/(landing)/page');

describe('LandingPage', () => {
  afterEach(() => {
    cleanup();
    resetPublicSessionCache();
  });

  it('server-renders the seven-section homepage in order', () => {
    const html = renderToStaticMarkup(<LandingPage />);

    expect(html.match(/<footer\b/g)).toHaveLength(1);
    expect(html).toContain('aria-label="The Timeline home"');
    expect(html).toContain('https://github.com/timborovkov/the-timeline-ai');
    expect(html).toContain('aria-label="The Timeline source code on GitHub"');
    // The source link is shared by both session variants.
    expect(html.match(/>Source on GitHub</g)).toHaveLength(1);
    expect(html).toContain('href="/cookies"');
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html).toContain('Know where the work stands.');
    expect(html).toContain(
      'Know what changed, what was agreed, and what still needs doing—without reading every conversation.',
    );

    const scenes = [
      '01-claim',
      '02-intake',
      '03-timeline',
      '04-ask',
      '05-organised',
      '06-audience',
      '07-start',
    ];
    let previousIndex = -1;
    for (const scene of scenes) {
      const sceneIndex = html.indexOf(`data-scene="${scene}"`);
      expect(sceneIndex).toBeGreaterThan(previousIndex);
      previousIndex = sceneIndex;
    }

    expect(html).toContain('Login issue · Illustrative example');
    expect(html).toContain(
      'aria-label="Work events stream from nine sources into The Timeline, where the work record keeps decisions, promises and next steps connected to their sources."',
    );
    expect(html).toContain('Follow the work as it changes.');
    expect(html).not.toContain('Fictional Acme example, not customer data.');
    expect(html).toContain('<details');
    expect(html).toContain('The Timeline');
    expect(html).toContain('Sources attached');
    expect(html).not.toContain('How scattered work becomes useful context.');
    expect(html).not.toContain('Connected, not used in this answer');
    expect(html).not.toContain('Sentry is connected, but unused in this answer.');
    expect(html).toContain('Each numbered reference matches a source shown here.');
    expect(html).not.toContain('5 of 6 sources used');
    expect(html).toContain('Telegram');
    expect(html).toContain('Linear');
    expect(html).toContain('Sentry');
    expect(html).toContain('/connectors/telegram.svg');
    expect(html).toContain('/connectors/google-meet.svg');
    expect(html.match(/data-hero-flow-path="ingest"/g)).toHaveLength(9);
    expect(html.match(/data-hero-flow-path="outcome"/g)).toHaveLength(1);
    expect(html.match(/data-hero-flow-packet="ingest"/g)).toHaveLength(9);
    expect(html.match(/data-hero-flow-packet="outcome"/g)).toHaveLength(1);
    expect(html).not.toContain('data-hero-flow-path="write"');
    expect(html).not.toContain('data-hero-flow-path="read"');
    expect(html).not.toContain('>Person<');
    expect(html).toContain('data-flow-motion');
    expect(html.match(/<animateMotion/g)).toHaveLength(10);
    expect(html).toContain('aria-label="Public navigation"');
    expect(html).toContain('href="/integrations"');
    expect(html).toContain('href="/how-it-works"');
    expect(html).toContain('href="/compare"');
    expect(html).toContain('href="/agents"');
    expect(html).not.toContain('data-agent-setup');
    expect(html).not.toContain('>AI assistants<');
    expect(html).toContain('Your agents work from the same record.');
    expect(html).toContain('Agent progress note');
    expect(html).toContain('Later answer');
    expect(html.indexOf('data-use-case-overview')).toBeGreaterThan(
      html.indexOf('data-scene="05-organised"'),
    );
    expect(html.match(/data-use-case-overview/g)).toHaveLength(1);
    expect(html).toContain('aria-label="Public navigation menu"');
    expect(html).toContain('A linked change merged. The customer outcome still needs checking.');
    expect(html).toContain('Sources behind this answer');
    expect(html).toContain('Source 01: Slack report');
    expect(html).toContain('See what changed and why.');
    expect(html).not.toContain('href="/use-cases/work-record"');
    expect(html).not.toContain('href="/use-cases/crm"');
    for (const href of [
      '/use-cases/team-daily-log',
      '/use-cases/customer-context',
      '/use-cases/task-board',
      '/help/documents',
    ]) {
      expect(html).toContain(`href="${href}"`);
    }
    expect(html).toContain('Every answer carries its evidence chain.');
    expect(html).not.toContain('Northline');
    expect(html.match(/data-home-diagram/g)).toHaveLength(1);
    expect(html.match(/data-home-panel-motion/g)).toHaveLength(3);
    expect(html.match(/data-home-proof=/g)).toHaveLength(6);
    expect(html).toContain('data-home-proof="11-timeline-dark.png"');
    expect(html).toContain('data-home-proof="17-timeline-voice-dark.png"');
    expect(html).toContain('data-home-proof="22-client-northstar-dark.png"');
    expect(html).toContain('data-home-proof="32-ask-handoff-dark.png"');
    expect(html).toContain('data-home-proof="33-digest-dark.png"');
    expect(html).toContain('data-screenshot-present="true"');
    expect(html).toContain('data-screenshot-pending');
    expect(html).toContain('Loading screenshot');
    expect(html).not.toContain('data-screenshot-callouts');
    expect(html).not.toContain('Who owns the next step');
    expect(html).not.toContain('Link to the source');
    expect(html).not.toContain('data-first-run="full"');
    expect(html).not.toContain('direct chat');
    expect(html).not.toContain('Screenshot placeholder');
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
      dateModified: '2026-11-24',
      lastReviewed: '2026-11-24',
    });
    expect(application?.featureList).toContain(
      'Native ingestion for GitHub, Linear, Google Drive, Monday.com, Slack, and Sentry',
    );
    expect(application?.featureList).toContain(
      'Source-linked history for applied changes and a review queue for exceptions',
    );
    expect(metadata).toMatchObject({
      title: 'A shared work record for teams and their AI agents',
      description:
        'Know what changed, what was agreed, and what still needs doing with a source-linked work record shared by people and AI agents.',
      alternates: { canonical: '/' },
      openGraph: {
        description:
          'Know what changed, what was agreed, and what still needs doing with a source-linked work record shared by people and AI agents.',
      },
    });
  });

  it('links the hero’s secondary action to the screenshot tour', () => {
    const { container } = render(<LandingPage />);
    const hero = container.querySelector('[data-scene="01-claim"]');
    expect(hero?.querySelector('a[href="/product-tour"]')?.textContent).toBe('Take the tour');
    expect(hero?.querySelectorAll('[data-hero-flow-path="ingest"]')).toHaveLength(9);
  });

  it('pairs ingest and answers with the right headings and removes screenshot interactions', () => {
    const { container } = render(<LandingPage />);
    const intake = container.querySelector('[data-scene="02-intake"]');
    const answer = container.querySelector('[data-scene="04-ask"]');
    expect(intake?.querySelector('h2')?.textContent).toBe(
      'Work happens across tools. Keeping up should be easier.',
    );
    expect(answer?.querySelector('h2')?.textContent).toBe('Ask where things stand.');
    expect(
      intake?.querySelectorAll('ul[aria-label="Ways to send work to Timeline"] > li'),
    ).toHaveLength(12);
    for (const name of [
      'Websites',
      'Documents',
      'GitHub',
      'Google Drive',
      'Linear',
      'Monday.com',
      'Sentry',
      'Ingest webhooks',
    ]) {
      expect(intake?.textContent).toContain(name);
    }
    expect(container.querySelector('[data-home-proof] ol')).toBeNull();
    expect(container.querySelector('[data-screenshot-file] a')).toBeNull();
    expect(container.textContent).not.toContain('Select the screenshot');
    expect(container.textContent).not.toContain('Fictional example');
  });

  it('states connector capabilities without inventing a connector destination', () => {
    const html = renderToStaticMarkup(<LandingPage />);

    for (const connector of ['GitHub', 'Linear', 'Google Drive', 'Monday.com', 'Slack', 'Sentry']) {
      expect(html).toContain(connector);
    }

    expect(html).toContain('Ask where things stand.');
    expect(html).toContain('Choose which channels and sources to connect.');
    expect(html).toContain('Turn conversations into shared context.');
    expect(html).toContain('ready to find and use in answers, with its source attached');
    expect(html).toContain('Telegram');
    expect(html).toContain('Email forwarding');
    expect(html).not.toContain('Connected tools');
    expect(html).not.toContain('Sync selected records.');
    expect(html).not.toContain('Two ways in');
    expect(html).toContain('Ingest webhooks');
    expect(html).not.toContain('Admin setup needed');
    expect(html).not.toContain('use enabled custom MCP tools when you ask a question');
    expect(html).not.toMatch(
      /Capture contract|Deliberate capture|Provider record sync|Available here|MCP is live approved access/u,
    );
    for (const surface of ['Telegram', 'Slack', 'Email forwarding', 'Meeting transcripts']) {
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
      'Know what changed, what was agreed, and what still needs doing—without reading every conversation.',
    );
    expect(html).toContain('Start with the tools your team already uses.');
    expect(html).toContain('Connect a source and ask about the work happening there.');
    expect(html).toContain('A call is one optional source.');
    expect(html).toContain('Follow the work as it changes.');
    expect(html).toContain('Search it by person, client or source.');
    expect(html).toContain('What did I work on this week?');
    expect(html).toContain('What changed with the login issue, and what still needs checking?');
    expect(html).toContain('source-available GitHub repo');
    expect(html).toContain('managed on-premise deployment');
    expect(html).toContain('href="/trust#deployment"');
    expect(html).toContain(
      'Tasks, people and projects stay connected to the activity behind them.',
    );
    expect(html).toContain('Open a view when you need it.');
    for (const record of ['Tasks', 'People', 'Projects', 'Companies', 'Deals']) {
      expect(html).toContain(`${record}</h3>`);
    }
    expect(html).not.toContain('update themselves');
    expect(html).toContain('Ingest webhooks');
    expect(html).not.toContain('A direct chat asks the agent');
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
    expect(html).toContain('Take the tour');
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

  it('shows every source detail inline without dialogs, disclosures or navigation', () => {
    const { container } = render(<LandingPage />);
    const block = container.querySelector('[data-scene="04-ask"]');
    const ledger = screen.getByRole('region', { name: 'Sources behind this answer' });
    expect(screen.getByRole('main').querySelector('aside')).toBeNull();
    expect(block?.querySelector('dialog')).toBeNull();
    expect(ledger.querySelector('button, a, details')).toBeNull();
    expect(block?.querySelector('a[href^="#login-source-"]')).toBeNull();
    for (const event of PUBLIC_DEMO_STORY.landing.events) {
      expect(ledger.textContent).toContain(event.detail);
    }
  });
});
