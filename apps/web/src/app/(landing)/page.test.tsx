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
    expect(html).toContain('The work <em>becomes</em> the record.');

    const scenes = ['01-claim', '02-chronology', '03-answer', '04-trust', '05-cta'];
    let previousIndex = -1;
    for (const scene of scenes) {
      const sceneIndex = html.indexOf(`data-scene="${scene}"`);
      expect(sceneIndex).toBeGreaterThan(previousIndex);
      previousIndex = sceneIndex;
    }

    expect(html).toContain('Acme rollout / Last 7 days');
    expect(html).toContain('Four cited Acme rollout work signals');
    expect(html).toContain('Example project / Acme rollout / 4 cited + 2 connected');
    expect(html).toContain('Connected, not cited');
    expect(html).toContain('Linear');
    expect(html).toContain('Sentry');
    expect(html).toContain('aria-label="Page sections"');
    expect(html).toContain('href="#answer"');
    expect(html).toContain('Launch is waiting on SSO. Everything else moved.');
    expect(html).toContain('Evidence behind this answer');
    expect(html).toContain('href="#acme-source-01"');
    expect(html).toContain('Source 01: Slack approval');
    expect(html).toContain('Teams that owe someone a reliable answer.');
    expect(html).toContain('Every answer carries its evidence chain.');
    expect(html).not.toContain('Northline');
    expect(html.match(/data-home-diagram/g)).toHaveLength(6);
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
      dateModified: '2026-08-13',
      lastReviewed: '2026-08-13',
    });
    expect(application?.featureList).toContain(
      'Native ingestion for GitHub, Linear, Google Drive, Monday.com, Slack, and Sentry',
    );
    expect(metadata).toMatchObject({
      title: 'The Timeline | The work becomes the record',
      alternates: { canonical: '/' },
    });
  });

  it('states connector capabilities without inventing a connector destination', async () => {
    const html = renderToStaticMarkup(await LandingPage());

    for (const connector of ['GitHub', 'Linear', 'Google Drive', 'Monday.com', 'Slack', 'Sentry']) {
      expect(html).toContain(connector);
    }

    expect(html).toContain('Native ingestion');
    expect(html).toContain('Where evidence enters');
    expect(html).toContain('Available here');
    expect(html).toContain('Setup required');
    expect(html).toContain('MCP access');
    expect(html).toContain('Live approved tool access, not passive ingestion.');
    expect(html).toContain('Not connectable or indexed until support is real.');
    expect(html).not.toContain('Future connector pages remain unindexed');
    expect(html).not.toContain('href="/integrations');
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
