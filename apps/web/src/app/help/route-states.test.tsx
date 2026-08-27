// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

const fakes = vi.hoisted(() => ({
  pathname: '/help/documents',
  reportCaughtError: vi.fn(),
}));

vi.mock('next/navigation', () => ({ usePathname: () => fakes.pathname }));
vi.mock('@/lib/sentry-report', () => ({ reportCaughtError: fakes.reportCaughtError }));
vi.mock('@/lib/auth', () => ({ auth: vi.fn().mockResolvedValue(null) }));

import HelpTopicError from '@/app/help/[slug]/error';
import HelpTopicLoading from '@/app/help/[slug]/loading';
import HelpTopicPage from '@/app/help/[slug]/page';
import ContactError from '@/app/help/contact/error';
import ContactLoading from '@/app/help/contact/loading';
import HelpError from '@/app/help/error';
import HelpLoading from '@/app/help/loading';
import HelpIndexPage from '@/app/help/page';
import SupportError from '@/app/help/support/error';
import SupportLoading from '@/app/help/support/loading';
import { HelpShell } from '@/components/help/help-shell';
import {
  TIMELINE_CLAUDE_PLUGIN_INSTALL_COMMAND,
  TIMELINE_PLUGIN_INSTALL_PROMPT,
  TIMELINE_SKILL_INSTALL_PROMPT,
} from '@/lib/agent-install-content';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  fakes.pathname = '/help/documents';
  window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
});

describe('Help route states', () => {
  it('keeps Help context and lets keyboard users retry a failed load', async () => {
    const user = userEvent.setup();
    const reset = vi.fn();

    render(<HelpError error={new Error('route failed')} reset={reset} />);

    expect(screen.getByRole('heading', { level: 1, name: 'Help' })).toBeTruthy();
    expect(screen.getByText('Guides for using Timeline and getting support.')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'Unable to load help' })).toBeTruthy();
    expect(
      screen.getByText(
        'The guide and support links are unchanged. Check your connection, then try again.',
      ),
    ).toBeTruthy();

    const retry = screen.getByRole('button', { name: 'Try again' });
    retry.focus();
    await user.keyboard('{Enter}');

    expect(reset).toHaveBeenCalledOnce();
  });

  it('announces loading outside inert, help-shaped visuals', () => {
    const { container } = render(<HelpLoading />);

    const announcement = screen.getByRole('status');
    expect(announcement.textContent).toBe('Loading help');
    expect(announcement.parentElement?.getAttribute('aria-busy')).toBeNull();
    const loading = screen.getByLabelText('Loading help');
    expect(loading.getAttribute('aria-busy')).toBe('true');
    expect(screen.getByRole('heading', { level: 1, name: 'Help' })).toBeTruthy();
    expect(screen.queryByRole('region')).toBeNull();
    const visuals = container.querySelector('[aria-busy="true"] > [aria-hidden="true"][inert]');
    expect(visuals).toBeTruthy();
    expect(
      visuals?.querySelectorAll('a, button, input, select, textarea, [tabindex]'),
    ).toHaveLength(0);
    expect(visuals?.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
  });

  it('identifies the guide navigation and exposes the current page', () => {
    render(
      <HelpShell isSignedIn={false}>
        <article>Guide content</article>
      </HelpShell>,
    );

    expect(screen.getByRole('navigation', { name: 'Help guides' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Document drive' }).getAttribute('aria-current')).toBe(
      'page',
    );
    expect(screen.getByRole('link', { name: 'Overview' }).hasAttribute('aria-current')).toBe(false);
  });

  it('centers the current guide horizontally without moving the document', () => {
    window.history.replaceState(null, '', '#restored-section');
    const restoredScrollY = window.scrollY;
    const { rerender } = render(
      <HelpShell isSignedIn={false}>
        <article>Guide content</article>
      </HelpShell>,
    );

    const guideNav = screen.getByRole('navigation', { name: 'Help guides' });
    const agentGuide = screen.getByRole('link', { name: 'Timeline for agents' });
    Object.defineProperties(guideNav, {
      clientWidth: { configurable: true, value: 320 },
      scrollLeft: { configurable: true, value: 40, writable: true },
      scrollWidth: { configurable: true, value: 800 },
    });
    vi.spyOn(guideNav, 'getBoundingClientRect').mockReturnValue({
      bottom: 60,
      height: 40,
      left: 20,
      right: 340,
      toJSON: () => ({}),
      top: 20,
      width: 320,
      x: 20,
      y: 20,
    });
    vi.spyOn(agentGuide, 'getBoundingClientRect').mockReturnValue({
      bottom: 60,
      height: 40,
      left: 500,
      right: 620,
      toJSON: () => ({}),
      top: 20,
      width: 120,
      x: 500,
      y: 20,
    });

    fakes.pathname = '/help/agents';
    rerender(
      <HelpShell isSignedIn={false}>
        <article>Guide content</article>
      </HelpShell>,
    );

    expect(
      screen.getByRole('link', { name: 'Timeline for agents' }).getAttribute('aria-current'),
    ).toBe('page');
    expect(guideNav.scrollLeft).toBe(420);
    expect(window.location.hash).toBe('#restored-section');
    expect(window.scrollY).toBe(restoredScrollY);
  });

  it('centers the current guide after its initial mobile layout becomes measurable', () => {
    let notifyResize: (() => void) | undefined;

    class ResizeObserverMock {
      constructor(callback: ResizeObserverCallback) {
        notifyResize = () => {
          callback([], this);
        };
      }

      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
      takeRecords = () => [];
    }

    vi.stubGlobal('ResizeObserver', ResizeObserverMock);
    fakes.pathname = '/help/agents';
    window.history.replaceState(null, '', '#restored-section');
    const restoredScrollY = window.scrollY;

    render(
      <HelpShell isSignedIn={false}>
        <article>Guide content</article>
      </HelpShell>,
    );

    const guideNav = screen.getByRole('navigation', { name: 'Help guides' });
    const agentGuide = screen.getByRole('link', { name: 'Timeline for agents' });
    Object.defineProperties(guideNav, {
      clientWidth: { configurable: true, value: 320 },
      scrollLeft: { configurable: true, value: 0, writable: true },
      scrollWidth: { configurable: true, value: 800 },
    });
    vi.spyOn(guideNav, 'getBoundingClientRect').mockReturnValue({
      bottom: 60,
      height: 40,
      left: 20,
      right: 340,
      toJSON: () => ({}),
      top: 20,
      width: 320,
      x: 20,
      y: 20,
    });
    vi.spyOn(agentGuide, 'getBoundingClientRect').mockReturnValue({
      bottom: 60,
      height: 40,
      left: 500,
      right: 620,
      toJSON: () => ({}),
      top: 20,
      width: 120,
      x: 500,
      y: 20,
    });

    expect(notifyResize).toBeTypeOf('function');
    notifyResize?.();

    expect(guideNav.scrollLeft).toBe(380);
    expect(window.location.hash).toBe('#restored-section');
    expect(window.scrollY).toBe(restoredScrollY);
  });

  it('gives Help discovery links a visible keyboard focus treatment', async () => {
    render(<HelpIndexPage />);

    for (const name of ['Document drive', 'Capture surfaces']) {
      const link = screen.getByRole('link', { name: new RegExp(name) });
      expect(link.className).toContain('focus-visible:ring-2');
      expect(link.className).toContain('focus-visible:ring-fg');
      expect(link.className).toContain('focus-visible:ring-offset-bg');
      expect(link.className).toContain('forced-colors:focus-visible:outline');
      expect(link.className).toContain('forced-colors:focus-visible:outline-2');
    }

    cleanup();
    render(await HelpTopicPage({ params: Promise.resolve({ slug: 'documents' }) }));

    for (const name of ['Capture surfaces', 'Work surface', 'Contact support']) {
      const link = screen.getByRole('link', { name });
      expect(link.className).toContain('focus-visible:ring-2');
      expect(link.className).toContain('focus-visible:ring-fg');
      expect(link.className).toContain('forced-colors:focus-visible:outline-2');
    }
  });

  it('provides a safe, copyable agent install prompt and public source links', async () => {
    const writeText = vi.fn<(value: string) => Promise<void>>().mockResolvedValue();
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    render(await HelpTopicPage({ params: Promise.resolve({ slug: 'agents' }) }));

    expect(
      screen.getByRole('heading', {
        level: 1,
        name: 'Connect your agent to what actually happened.',
      }),
    ).toBeTruthy();
    expect(
      screen.getByRole('heading', { level: 2, name: 'From install to first answer' }),
    ).toBeTruthy();
    expect(
      screen.getByRole('heading', { level: 2, name: 'Access, without surprises' }),
    ).toBeTruthy();
    expect(screen.getByRole('heading', { level: 3, name: 'Timeline' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 3, name: 'Codex' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 3, name: 'Claude Code' })).toBeTruthy();
    expect(screen.getByText('timeline')).toBeTruthy();
    expect(
      screen.getByText(/workspace evidence visible to you as the authorizing member/i),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Copy Codex install prompt' }));
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(TIMELINE_PLUGIN_INSTALL_PROMPT);
    });
    expect(TIMELINE_PLUGIN_INSTALL_PROMPT).toContain(
      'codex plugin marketplace add timborovkov/the-timeline-ai',
    );
    expect(TIMELINE_PLUGIN_INSTALL_PROMPT).toContain('codex plugin add timeline@timeline');
    expect(TIMELINE_PLUGIN_INSTALL_PROMPT).toContain(
      'The bundled MCP connection uses Timeline OAuth',
    );
    expect(TIMELINE_PLUGIN_INSTALL_PROMPT).toContain(
      'sign in to Timeline, choose the team to share',
    );
    expect(TIMELINE_PLUGIN_INSTALL_PROMPT).toContain('The default scope is read');
    expect(TIMELINE_PLUGIN_INSTALL_PROMPT).toContain(
      'Never request agent:ask unless I explicitly ask',
    );
    expect(TIMELINE_PLUGIN_INSTALL_PROMPT).not.toContain('TIMELINE_MCP_KEY');
    expect(TIMELINE_PLUGIN_INSTALL_PROMPT).toContain('the timeline skill is installed');

    fireEvent.click(screen.getByRole('button', { name: 'Copy Claude Code install commands' }));
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(TIMELINE_CLAUDE_PLUGIN_INSTALL_COMMAND);
    });
    expect(TIMELINE_CLAUDE_PLUGIN_INSTALL_COMMAND).toContain(
      'claude plugin marketplace add timborovkov/the-timeline-ai',
    );
    expect(TIMELINE_CLAUDE_PLUGIN_INSTALL_COMMAND).toContain(
      'claude plugin install timeline@timeline',
    );
    expect(screen.getByText('Start a Timeline-backed task')).toBeTruthy();
    expect(screen.getByText(/third-party tools may have external side effects/i)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Copy skill prompt' }));
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(TIMELINE_SKILL_INSTALL_PROMPT);
    });
    expect(TIMELINE_SKILL_INSTALL_PROMPT).toContain('/plugins/timeline/skills/timeline');
    expect(TIMELINE_SKILL_INSTALL_PROMPT).not.toContain('timeline-weekly-update');

    const skillLink = screen.getByRole('link', { name: 'View skill' });
    expect(skillLink.getAttribute('href')).toBe(
      'https://github.com/timborovkov/the-timeline-ai/tree/main/plugins/timeline/skills/timeline',
    );

    const codexInstallLink = screen.getByRole('link', { name: 'Read the Codex install guide' });
    expect(codexInstallLink.getAttribute('href')).toBe(
      'https://github.com/timborovkov/the-timeline-ai/tree/main/plugins/timeline/skills#install-in-codex',
    );
    expect(codexInstallLink.getAttribute('target')).toBe('_blank');
    expect(codexInstallLink.getAttribute('rel')).toBe('noreferrer');

    const claudeInstallLink = screen.getByRole('link', {
      name: 'Read the Claude Code install guide',
    });
    expect(claudeInstallLink.getAttribute('href')).toBe(
      'https://github.com/timborovkov/the-timeline-ai/tree/main/plugins/timeline/skills#install-in-claude-code',
    );
    expect(claudeInstallLink.getAttribute('target')).toBe('_blank');
    expect(claudeInstallLink.getAttribute('rel')).toBe('noreferrer');
    expect(screen.getByRole('link', { name: 'Sign in to open' })).toBeTruthy();
  });

  it('searches full guide content and provides a clear empty state', async () => {
    const user = userEvent.setup();
    render(<HelpIndexPage />);

    const search = screen.getByRole('searchbox', { name: 'Search guides' });
    expect(search.className).toContain('[&::-webkit-search-cancel-button]:appearance-none');
    await user.type(search, 'kanban');

    expect(screen.getByRole('link', { name: /Boards/ })).toBeTruthy();
    expect(screen.queryByRole('link', { name: /Document drive/ })).toBeNull();
    expect(screen.getByRole('status').textContent).toBe('1 guide found');

    await user.clear(search);
    await user.type(search, 'restart Codex');

    expect(screen.getByRole('link', { name: /Timeline for agents/ })).toBeTruthy();
    expect(screen.queryByRole('link', { name: /Boards/ })).toBeNull();
    expect(screen.getByRole('status').textContent).toBe('1 guide found');

    await user.clear(search);
    await user.type(search, 'not a timeline feature');

    expect(screen.getByText('No guide matches “not a timeline feature”')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Clear search' }));

    expect(screen.getByRole('link', { name: /Document drive/ })).toBeTruthy();
    expect((search as HTMLInputElement).value).toBe('');
  });
});

const helpChildRoutes = [
  {
    errorDescription:
      'This error did not change the guide content. Check your connection, then try again.',
    errorPageDescription: 'This Timeline guide could not be loaded.',
    ErrorComponent: HelpTopicError,
    Loading: HelpTopicLoading,
    loadingDescription: 'Loading this Timeline guide.',
    pathname: '/help/documents',
    title: 'Guide',
  },
  {
    errorDescription:
      'This error did not send or change any support request. Check your connection, then try again.',
    errorPageDescription: 'The support request form could not be opened.',
    ErrorComponent: ContactError,
    Loading: ContactLoading,
    loadingDescription: 'Opening the support request form.',
    pathname: '/help/contact',
    title: 'Contact support',
  },
  {
    errorDescription:
      'This error did not send or change any support request. Check your connection, then try again.',
    errorPageDescription: 'The support request form could not be loaded.',
    ErrorComponent: SupportError,
    Loading: SupportLoading,
    loadingDescription: 'Loading the support request form.',
    pathname: '/help/support',
    title: 'Support',
  },
] as const;

describe('Help child route states', () => {
  it.each(helpChildRoutes)(
    'announces a $title loading state outside its busy, Help-shaped placeholder',
    ({ Loading, loadingDescription, pathname, title }) => {
      fakes.pathname = pathname;
      render(
        <HelpShell isSignedIn={false}>
          <Loading />
        </HelpShell>,
      );

      const announcement = screen.getByRole('status');
      expect(announcement.textContent).toBe(`Loading ${title}`);
      expect(announcement.parentElement?.getAttribute('aria-busy')).toBeNull();
      expect(screen.getByLabelText(`${title} loading placeholder`).getAttribute('aria-busy')).toBe(
        'true',
      );
      expect(screen.getAllByRole('heading', { level: 1, name: title })).toHaveLength(1);
      expect(screen.getByRole('heading', { level: 1, name: title }).className).toContain(
        'text-2xl',
      );
      expect(screen.getByRole('heading', { level: 1, name: title }).className).not.toContain(
        'sm:text-4xl',
      );
      expect(screen.getByRole('navigation', { name: 'Help guides' })).toBeTruthy();
      expect(screen.getByText(loadingDescription)).toBeTruthy();
      const visuals = screen
        .getByLabelText(`${title} loading placeholder`)
        .querySelector('[aria-hidden="true"][inert]');
      expect(visuals).toBeTruthy();
      expect(
        visuals?.querySelectorAll('a, button, input, select, textarea, [tabindex]'),
      ).toHaveLength(0);
      expect(
        within(screen.getByRole('navigation', { name: 'Help guides' }))
          .getByRole('link', {
            name: 'Support',
          })
          .getAttribute('aria-current'),
      ).toBe(pathname === '/help/contact' || pathname === '/help/support' ? 'page' : null);
    },
  );

  it.each(helpChildRoutes)(
    'keeps Help context and lets keyboard users retry the $title error',
    async ({ errorDescription, errorPageDescription, ErrorComponent, pathname, title }) => {
      const user = userEvent.setup();
      const reset = vi.fn();
      fakes.pathname = pathname;

      render(
        <HelpShell isSignedIn={false}>
          <ErrorComponent error={new Error('route failed')} reset={reset} />
        </HelpShell>,
      );

      expect(screen.getAllByRole('heading', { level: 1, name: title })).toHaveLength(1);
      expect(screen.getByRole('heading', { level: 1, name: title }).className).toContain(
        'text-2xl',
      );
      expect(screen.getByRole('heading', { level: 1, name: title }).className).not.toContain(
        'sm:text-4xl',
      );
      expect(screen.getByRole('navigation', { name: 'Help guides' })).toBeTruthy();
      expect(
        screen.getByRole('heading', { level: 2, name: `Unable to load ${title}` }),
      ).toBeTruthy();
      expect(screen.getByText(errorDescription)).toBeTruthy();
      expect(screen.getByText(errorPageDescription)).toBeTruthy();
      expect(
        within(screen.getByRole('navigation', { name: 'Help guides' }))
          .getByRole('link', {
            name: 'Support',
          })
          .getAttribute('aria-current'),
      ).toBe(pathname === '/help/contact' || pathname === '/help/support' ? 'page' : null);

      const retry = screen.getByRole('button', { name: 'Try again' });
      retry.focus();
      await user.keyboard('{Enter}');
      await user.keyboard('[Space]');

      expect(reset).toHaveBeenCalledTimes(2);
    },
  );
});
