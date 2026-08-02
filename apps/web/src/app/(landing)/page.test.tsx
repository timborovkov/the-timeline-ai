// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fakes = vi.hoisted(() => ({ auth: vi.fn() }));

vi.mock('@/lib/auth', () => ({ auth: fakes.auth }));

const { default: LandingPage } = await import('@/app/(landing)/page');

describe('LandingPage', () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    fakes.auth.mockResolvedValue(null);
  });

  it('keeps the archive marketing structure with problem, principles, and cited evidence', async () => {
    const html = renderToStaticMarkup(await LandingPage());

    expect(html.match(/<header\b/g)).toHaveLength(1);
    expect(html.match(/<footer\b/g)).toHaveLength(1);
    expect(html).toContain('aria-label="The Timeline — home"');
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html).toContain('Ask what changed.');
    expect(html).toContain('Teams do the work, then separately report that the work happened.');
    expect(html).toContain('CONCEPTS · CAPTURE → EVIDENCE → OPERATIONAL MEMORY');
    expect(html).toContain('PRINCIPLES · BUILT FOR THE WORK');
    expect(html).toContain('WITHOUT TIMELINE');
    expect(html).toContain('WITH TIMELINE');
    expect(html).toContain('linear-gradient');
    expect(html).not.toContain('aria-label="Public"');
  });

  it('keeps the marketing page browsable for signed-in users with dashboard CTAs', async () => {
    fakes.auth.mockResolvedValue({ user: { id: 'user-1' } });

    const html = renderToStaticMarkup(await LandingPage());

    expect(html).toContain('Go to dashboard');
    expect(html).toContain('href="/app"');
    expect(html).not.toContain('Create team');
    expect(html).not.toContain('href="/sign-in"');
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
  });
});
