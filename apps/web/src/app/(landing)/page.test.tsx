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
    // The complete metadata row reserves both session variants; only one is visible.
    expect(html.match(/>Source on GitHub</g)).toHaveLength(2);
    expect(html).toContain('href="/cookies"');
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html).toContain('Your team&#x27;s work, <em>written</em> down for you');
    expect(html).toContain(
      'Your team&#x27;s work record: everything your team does, on one searchable timeline, kept current from Slack, Telegram, email and calls.',
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

    expect(html).toContain('Acme rollout / Last 7 days');
    expect(html).toContain(
      'aria-label="Work events stream from six sources into The Timeline, where the work record becomes a daily update and linked answers."',
    );
    expect(html).toContain('one timeline');
    expect(html).not.toContain('Fictional Acme example, not customer data.');
    expect(html).toContain('<details');
    expect(html).toContain('The Timeline');
    expect(html).toContain('Work record');
    expect(html).toContain('Daily update');
    expect(html).toContain('Linked answers');
    expect(html).not.toContain('How scattered work becomes useful context.');
    expect(html).not.toContain('Connected, not used in this answer');
    expect(html).not.toContain('Sentry is connected, but unused in this answer.');
    expect(html).toContain('Select a reference to read its source.');
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
    expect(html).not.toContain('data-hero-flow-path="write"');
    expect(html).not.toContain('data-hero-flow-path="read"');
    expect(html).not.toContain('>Person<');
    expect(html).toContain('data-flow-motion');
    expect(html.match(/<animateMotion/g)).toHaveLength(7);
    expect(html).toContain('aria-label="Public navigation"');
    expect(html).toContain('href="/integrations"');
    expect(html).toContain('href="/how-it-works"');
    expect(html).toContain('href="/compare"');
    expect(html).toContain('href="/agents"');
    expect(html).toContain('data-agent-setup');
    expect(html).toContain('llms.txt');
    expect(html).not.toContain('>AI assistants<');
    expect(html).toContain('What did we promise Northstar?');
    expect(html).toContain('Your chat. Your agent. One <em>record.</em>');
    expect(html).toContain('aria-label="Chat conversation"');
    expect(html).toContain('aria-label="Agent conversation"');
    expect(html).not.toContain('timeline.retrieve_workspace_context');
    expect(html).not.toContain('timeline.get_event');
    expect(html).toContain('data-chat-to-answer');
    expect(html).toContain('aria-label="Public navigation menu"');
    expect(html).toContain('SSO blocks launch. Friday’s customer update is still due.');
    expect(html).toContain('Sources behind this answer');
    expect(html).not.toContain('Evidence behind this answer');
    expect(html).not.toContain('href="#acme-source-01"');
    expect(html).toContain('Source 01: Telegram group message');
    expect(html).toContain('Built for teams that run their work through <em>chat.</em>');
    expect(html).toContain('href="/use-cases/work-record"');
    expect(html).toContain('href="/use-cases/team-daily-log"');
    expect(html).toContain('href="/use-cases/crm"');
    expect(html).toContain('<a href="/use-cases/work-record"><span>01</span><h4>Work record</h4>');
    expect(html).toContain(
      '<a href="/use-cases/team-daily-log"><span>02</span><h4>Team daily log</h4>',
    );
    expect(html).toContain('<a href="/use-cases/crm"><span>04</span><h4>CRM</h4>');
    expect(html).toContain('on one timeline, with where it was said.');
    expect(html).toContain('Every answer carries its evidence chain.');
    expect(html).toContain('Suggested changes wait');
    expect(html).toContain('A person approves each one.');
    expect(html).not.toContain('Suggested changes wait — human approval required.');
    expect(html).not.toContain('Northline');
    expect(html.match(/data-home-diagram/g)).toHaveLength(5);
    expect(html.match(/data-home-proof=/g)).toHaveLength(5);
    expect(html).toContain('data-home-proof="11-timeline-dark.png"');
    expect(html).toContain('data-home-proof="17-timeline-voice-dark.png"');
    expect(html).toContain('data-home-proof="22-client-northstar-dark.png"');
    expect(html).toContain('data-home-proof="32-ask-handoff-dark.png"');
    expect(html).toContain('data-home-proof="33-digest-dark.png"');
    expect(html).toContain('data-screenshot-present="true"');
    expect(html).toContain('data-screenshot-pending');
    expect(html).toContain('Loading screenshot');
    expect(html).not.toContain('data-screenshot-callouts');
    expect(html).not.toContain('What changed');
    expect(html).not.toContain('Who owns the next step');
    expect(html).not.toContain('Link to the source');
    expect(html).toContain('data-first-run="full"');
    expect(html).toContain('Your first team is created');
    expect(html).toContain('Bring something in');
    expect(html).toContain(
      'Scan a website, upload a document, forward an email, or connect Slack or Telegram.',
    );
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
      dateModified: '2026-11-07',
      lastReviewed: '2026-11-07',
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

  it('pairs ingest and answers with the right headings and removes screenshot interactions', () => {
    const { container } = render(<LandingPage />);
    const intake = container.querySelector('[data-scene="02-intake"]');
    const answer = container.querySelector('[data-scene="04-ask"]');
    expect(intake?.querySelector('h2')?.textContent).toBe('Bring the work in. Keep the context.');
    expect(answer?.querySelector('h2')?.textContent).toBe(
      'Status should not require an investigation.',
    );
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

    expect(html).toContain('Status should not require an <em>investigation.</em>');
    expect(html).toContain('forward email, upload documents, or scan a public website');
    expect(html).toContain('Its transcript sits beside the original audio');
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
      'Your team&#x27;s work record: everything your team does, on one searchable timeline, kept current from Slack, Telegram, email and calls.',
    );
    expect(html).toContain('Link one channel. Watch the <em>record</em> fill in.');
    expect(html).toContain('approve the suggested updates');
    expect(html).toContain(
      'Jira and Pipedrive can miss what was said in conversation. Bring those decisions and promises into the same chronology.',
    );
    expect(html).toContain('Everything lands on one <em>timeline.</em>');
    expect(html).toContain('Search it by person, client or source.');
    expect(html).toContain('Get a status or handoff brief without retracing every conversation.');
    expect(html).toContain(
      'Give me the current status, handoff, blockers, and customer commitments.',
    );
    expect(html).toContain(
      'Replace manual CRM and task-board entry with suggested updates from your conversations.',
    );
    expect(html).toContain('ready for your <em>review.</em>');
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

  it('opens the matching source locally instead of navigating to the earlier timeline', async () => {
    const user = userEvent.setup();
    const { container } = render(<LandingPage />);
    const block = container.querySelector('[data-scene="04-ask"]');
    expect(block?.querySelector('a[href^="#acme-source-"]')).toBeNull();
    expect(block?.querySelector('details')).toBeNull();
    for (const event of PUBLIC_DEMO_STORY.landing.events) {
      const trigger = screen.getByRole('button', { name: new RegExp(`Source ${event.id}:`) });
      await user.click(trigger);
      const dialog = screen.getByRole('dialog', { name: event.title });
      expect(dialog.textContent).toContain(event.detail);
      (dialog as HTMLDialogElement).close();
    }
  });
});
