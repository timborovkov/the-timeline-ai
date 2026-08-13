// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fakes = vi.hoisted(() => ({ auth: vi.fn(), listCatalog: vi.fn() }));

vi.mock('@/lib/auth', () => ({ auth: fakes.auth }));
vi.mock('@timeline/shared/integrations/registry', () => ({ listCatalog: fakes.listCatalog }));

const { default: LandingPage } = await import('@/app/(landing)/page');

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

  it('server-renders the seven-scene evidence narrative in order', async () => {
    const html = renderToStaticMarkup(await LandingPage());

    expect(html.match(/<footer\b/g)).toHaveLength(1);
    expect(html).toContain('aria-label="The Timeline home"');
    expect(html).toContain('https://github.com/timborovkov/the-timeline-ai');
    expect(html).toContain('aria-label="The Timeline source code on GitHub"');
    expect(html.match(/>Source on GitHub</g)).toHaveLength(1);
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html).toContain('The work <em>becomes</em> the record.');

    const scenes = [
      '01-claim',
      '02-sources',
      '03-chronology',
      '04-answer',
      '05-audience',
      '06-trust',
      '07-cta',
    ];
    let previousIndex = -1;
    for (const scene of scenes) {
      const sceneIndex = html.indexOf(`data-scene="${scene}"`);
      expect(sceneIndex).toBeGreaterThan(previousIndex);
      previousIndex = sceneIndex;
    }

    expect(html).toContain('Northline / Last 7 days');
    expect(html).toContain('Launch is waiting on SSO. Everything else moved.');
    expect(html).toContain('Evidence behind this answer');
    expect(html).toContain('href="#northline-source-01"');
    expect(html).toContain('Source 01: Slack approval');
    expect(html).not.toContain('aria-hidden="true" data-home-root');
  });

  it('states connector capabilities without linking to unbuilt acquisition pages', async () => {
    const html = renderToStaticMarkup(await LandingPage());

    for (const connector of ['GitHub', 'Linear', 'Google Drive', 'Monday.com', 'Slack', 'Sentry']) {
      expect(html).toContain(connector);
    }

    expect(html).toContain('Native ingestion');
    expect(html).toContain('Native ingestion / available on this deployment');
    expect(html).toContain('Implemented / awaiting deployment configuration');
    expect(html).toContain('MCP access');
    expect(html).toContain(
      'Planned connectors are labeled before launch and cannot be connected yet.',
    );
    expect(html).not.toContain('Future connector pages remain unindexed');
    expect(html).not.toContain('href="/integrations');
    expect(html).not.toContain('href="/guides');
    expect(html).not.toContain('href="/record');
  });

  it('keeps the marketing page browsable for signed-in users with dashboard CTAs', async () => {
    fakes.auth.mockResolvedValue({ user: { id: 'user-1' } });

    const html = renderToStaticMarkup(await LandingPage());

    expect(html).toContain('Go to dashboard');
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
