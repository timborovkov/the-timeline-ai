// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fakes = vi.hoisted(() => ({ auth: vi.fn(), listCatalog: vi.fn() }));

vi.mock('@/lib/auth', () => ({ auth: fakes.auth }));
vi.mock('@timeline/shared/integrations/registry', () => ({ listCatalog: fakes.listCatalog }));

const { default: LandingPage, metadata } = await import('@/app/(landing)/page');

describe('LandingPage', () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    fakes.auth.mockResolvedValue(null);
    fakes.listCatalog.mockReturnValue(
      ['GitHub', 'Linear', 'Google Drive', 'Monday.com', 'Slack', 'Sentry'].map((label, index) => ({
        kind: 'native',
        ingestStatus: 'implemented',
        label,
        status: index < 2 ? 'native_available' : 'native_unconfigured',
      })),
    );
  });

  it('server-renders the five-scene evidence narrative in order', async () => {
    const html = renderToStaticMarkup(await LandingPage());

    expect(html.match(/<footer\b/g)).toHaveLength(1);
    expect(html).toContain('aria-label="The Timeline home"');
    expect(html).toContain('https://github.com/timborovkov/the-timeline-ai');
    expect(html).toContain('aria-label="The Timeline source code on GitHub"');
    expect(html.match(/>Source on GitHub</g)).toHaveLength(1);
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html).toContain('Scattered work. <em>Cited answers.</em>');

    const scenes = ['01-claim', '02-chronology', '03-answer', '04-trust', '05-cta'];
    let previousIndex = -1;
    for (const scene of scenes) {
      const sceneIndex = html.indexOf(`data-scene="${scene}"`);
      expect(sceneIndex).toBeGreaterThan(previousIndex);
      previousIndex = sceneIndex;
    }

    expect(html).toContain('Acme rollout / Last 7 days');
    expect(html).toContain(
      'aria-label="Work events stream from six sources into The Timeline, where project history becomes working records and cited answers."',
    );
    expect(html).not.toContain('Fictional Acme example, not customer data.');
    expect(html).toContain('The Timeline');
    expect(html).toContain('Project history');
    expect(html).toContain('Working records');
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
    expect(html).toContain('Teams that owe someone a reliable answer.');
    expect(html).toContain('href="/solutions/crm-context-from-team-activity"');
    expect(html).toContain('href="/solutions/client-project-handoffs"');
    expect(html).toContain('href="/solutions/weekly-project-updates"');
    expect(html).toContain(
      '<a href="/solutions/client-project-handoffs"><span>01</span><h4>Client delivery</h4>',
    );
    expect(html).toContain(
      '<a href="/solutions/crm-context-from-team-activity"><span>02</span><h4>Sales and account teams</h4>',
    );
    expect(html).toContain(
      '<a href="/solutions/weekly-project-updates"><span>03</span><h4>Product and engineering</h4>',
    );
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
    const graph = JSON.parse(jsonLd ?? '{"@graph":[]}') as {
      '@graph': Record<string, unknown>[];
    };
    const webPage = graph['@graph'].find((node) => node['@type'] === 'WebPage');
    const application = graph['@graph'].find((node) => node['@type'] === 'SoftwareApplication');
    expect(webPage).toMatchObject({
      dateModified: '2026-08-21',
      lastReviewed: '2026-08-21',
    });
    expect(application?.featureList).toContain(
      'Native ingestion for GitHub, Linear, Google Drive, Monday.com, Slack, and Sentry',
    );
    expect(application?.featureList).toContain(
      'Human approval before inferred durable workspace changes',
    );
    expect(metadata).toMatchObject({
      title: 'AI Team Memory With Cited Answers',
      description:
        'Timeline turns selected chats, meetings, documents, tickets, and code into a searchable project history. Ask questions and verify every claim at the source.',
      alternates: { canonical: '/' },
      openGraph: {
        description:
          'Timeline turns selected chats, meetings, documents, tickets, and code into a searchable project history. Ask questions and verify every claim at the source.',
      },
    });
  });

  it('states connector capabilities without inventing a connector destination', async () => {
    const html = renderToStaticMarkup(await LandingPage());

    for (const connector of ['GitHub', 'Linear', 'Google Drive', 'Monday.com', 'Slack', 'Sentry']) {
      expect(html).toContain(connector);
    }

    expect(html).toContain('Where evidence enters');
    expect(html).toContain('Two ways in. One cited record.');
    expect(html).toContain('Messages and files');
    expect(html).toContain('Send the work to Timeline.');
    expect(html).toContain('Connected tools');
    expect(html).toContain('Sync selected records.');
    expect(html).toContain('Ready to connect');
    expect(html).toContain('Admin setup needed');
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

  it('renders the product, problem, workflow, and trust contract without implying passive capture', async () => {
    const html = renderToStaticMarkup(await LandingPage());

    expect(html).toContain('Timeline is AI team memory for real projects.');
    expect(html).toContain(
      'Work can begin in a linked Telegram group or Slack channel, then spread through meetings, documents, tickets, code, automations, and email.',
    );
    expect(html).toContain(
      'Rebuilding status, handoffs, customer commitments, and decisions becomes slow—and the result is easy to get wrong.',
    );
    expect(html).toContain('documents, tickets, and code you choose in one chronological record');
    expect(html).toContain('trace each claim back to the source');
    expect(html).toContain('preserves source, time, and visibility');
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

  it('keeps signed-out calls to action on public pages or the real account conversion path', async () => {
    const html = renderToStaticMarkup(await LandingPage());

    expect(html.match(/href="\/sign-up"/g)).toHaveLength(3);
    expect(html).toContain('href="/how-it-works"');
    expect(html).not.toContain('<video');
    expect(html).not.toMatch(/watch (?:the )?demo|interactive demo/iu);
    expect(html).not.toMatch(/href="(?:\/(?:app\/)?demo|\/workspace\/demo|https?:\/\/t\.me\/)/u);
    expect(html).not.toMatch(/href="\/(?:app\/)?(?:seed|acme)(?:\/|"|\?)/iu);
  });

  it('keeps the marketing page browsable for signed-in users with dashboard CTAs', async () => {
    fakes.auth.mockResolvedValue({ user: { id: 'user-1' } });

    const html = renderToStaticMarkup(await LandingPage());

    expect(html).toContain('Go to dashboard');
    expect(html).toContain('<span aria-hidden="true">→</span>');
    expect(html).toContain('href="/app"');
    expect(html).not.toContain('Create team');
    expect(html).not.toContain('href="/sign-in"');
    expect(html).not.toContain('href="/sign-up"');
  });

  it('moves keyboard focus to main when the landing skip link is activated', async () => {
    const user = userEvent.setup();

    render(await LandingPage());

    const skipLink = screen.getByRole('link', { name: 'Skip to main content' });
    const main = screen.getByRole('main');
    skipLink.focus();

    await user.keyboard('{Enter}');

    expect(main.tabIndex).toBe(-1);
    expect(document.activeElement).toBe(main);
    expect(skipLink.className).toContain('focus:z-[90]');
  });
});
