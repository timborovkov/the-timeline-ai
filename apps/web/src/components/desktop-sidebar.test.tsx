import { runInNewContext } from 'node:vm';

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type { TeamMembership } from '@/lib/active-team';
import type { ReactNode } from 'react';

import { DesktopSidebar } from '@/components/desktop-sidebar';
import {
  SIDEBAR_PREFERENCE_BOOTSTRAP,
  persistSidebarExpanded,
  sidebarExpandedFromCookie,
} from '@/lib/sidebar-preference';

function sidebarCookieDocument(
  pathname: string,
  initial: { app?: 'true' | 'false'; root?: 'true' | 'false' } = {},
) {
  let app = initial.app;
  let root = initial.root;
  const writes: string[] = [];
  const document = Object.defineProperty({}, 'cookie', {
    get: () =>
      [
        ...(pathname.startsWith('/app') && app !== undefined
          ? [`timeline_sidebar_expanded=${app}`]
          : []),
        ...(root !== undefined ? [`timeline_sidebar_expanded=${root}`] : []),
      ].join('; '),
    set: (assignment: string) => {
      writes.push(assignment);
      const path = /(?:^|;)\s*Path=([^;]+)/.exec(assignment)?.[1];
      const value = assignment.split(';', 1)[0]?.split('=', 2)[1];
      const next = value === 'true' || value === 'false' ? value : undefined;
      if (path === '/app') app = next;
      if (path === '/') root = next;
    },
  });
  return {
    document,
    read: () => ({ app, root }),
    writes,
  };
}

vi.mock('@/components/rail-nav', () => ({
  RailNav: ({ expanded }: { expanded: boolean }) => <nav data-expanded={expanded} />,
}));

vi.mock('@/components/team-switcher', () => ({
  TeamSwitcher: ({ variant }: { variant: string }) => <button type="button">{variant}</button>,
}));

vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: ReactNode }) => children,
  TooltipContent: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => children,
}));

describe('DesktopSidebar', () => {
  const active: TeamMembership = {
    teamId: 'team-1',
    teamName: 'AuditAI',
    teamSlug: 'auditai',
    role: 'owner',
  };

  it('server-renders the persisted collapsed state on the first frame', () => {
    const html = renderToStaticMarkup(
      <DesktopSidebar
        active={active}
        memberships={[active]}
        recipientInvites={[]}
        initialExpanded={false}
      />,
    );

    expect(html).toContain('data-expanded="false"');
    expect(html).toContain('w-14 items-center px-0');
    expect(html).toContain('href="/app"');
    expect(html).toContain('aria-label="The Timeline home"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('>rail</button>');
    expect(html).not.toContain('min-w-0 flex-1 truncate font-mono');
  });

  it('disables the sidebar-width transition when reduced motion is preferred', () => {
    const html = renderToStaticMarkup(
      <DesktopSidebar
        active={active}
        memberships={[active]}
        recipientInvites={[]}
        initialExpanded
      />,
    );

    expect(html).toContain('data-expanded="true"');
    expect(html).toContain('href="/app"');
    expect(html).toContain('aria-label="The Timeline home"');
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('aria-label="Open Help &amp; support in a new tab"');
    expect(html).toContain('Help &amp; support');
    expect(html).toContain('transition-[width] duration-200 motion-reduce:transition-none');
  });

  it('defaults to expanded unless the cookie explicitly stores false', () => {
    expect(sidebarExpandedFromCookie(undefined)).toBe(true);
    expect(sidebarExpandedFromCookie('true')).toBe(true);
    expect(sidebarExpandedFromCookie('false')).toBe(false);
  });

  it('expires the legacy root cookie before persisting a scoped preference', () => {
    const cookie = sidebarCookieDocument('/app/timeline', { root: 'true' });
    const previousDocument = globalThis.document;
    const previousWindow = globalThis.window;
    Object.defineProperty(globalThis, 'document', { configurable: true, value: cookie.document });
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        localStorage: { setItem: vi.fn() },
        location: { protocol: 'https:' },
      },
    });

    try {
      persistSidebarExpanded(false);
    } finally {
      Object.defineProperty(globalThis, 'document', {
        configurable: true,
        value: previousDocument,
      });
      Object.defineProperty(globalThis, 'window', {
        configurable: true,
        value: previousWindow,
      });
    }

    expect(cookie.read()).toEqual({ app: 'false', root: undefined });
    expect(cookie.writes[0]).toContain('Path=/; Max-Age=0');
    expect(cookie.writes[1]).toContain('Path=/app');
    expect(cookie.writes[1]).toContain('Secure');
  });

  it('migrates the existing local preference before rendering and reloads only once', () => {
    const cookie = sidebarCookieDocument('/app/timeline', { root: 'false' });
    const reload = vi.fn();
    const context = {
      document: cookie.document,
      localStorage: { getItem: () => 'false' },
      location: { pathname: '/app/timeline', protocol: 'https:', reload },
    };

    runInNewContext(SIDEBAR_PREFERENCE_BOOTSTRAP, context);
    runInNewContext(SIDEBAR_PREFERENCE_BOOTSTRAP, context);

    expect(cookie.read()).toEqual({ app: 'false', root: undefined });
    expect(cookie.writes[0]).toContain('Path=/; Max-Age=0');
    expect(cookie.writes[1]).toContain('Path=/app');
    expect(cookie.writes[1]).toContain('Secure');
    expect(reload).toHaveBeenCalledOnce();
  });

  it('expires only the legacy root cookie and keeps an existing app preference', () => {
    const cookie = sidebarCookieDocument('/app/timeline', { app: 'true', root: 'false' });
    const reload = vi.fn();

    runInNewContext(SIDEBAR_PREFERENCE_BOOTSTRAP, {
      document: cookie.document,
      localStorage: { getItem: () => 'false' },
      location: { pathname: '/app/timeline', protocol: 'https:', reload },
    });

    expect(cookie.read()).toEqual({ app: 'true', root: undefined });
    expect(cookie.writes).toHaveLength(1);
    expect(cookie.writes[0]).toContain('Path=/; Max-Age=0');
    expect(reload).not.toHaveBeenCalled();
  });

  it('preserves the legacy preference when local storage is unavailable', () => {
    const cookie = sidebarCookieDocument('/app', { root: 'false' });
    const reload = vi.fn();

    runInNewContext(SIDEBAR_PREFERENCE_BOOTSTRAP, {
      document: cookie.document,
      localStorage: {
        getItem: () => {
          throw new Error('storage blocked');
        },
      },
      location: { pathname: '/app', protocol: 'https:', reload },
    });

    expect(cookie.read()).toEqual({ app: 'false', root: undefined });
    expect(cookie.writes[0]).toContain('Path=/; Max-Age=0');
    expect(cookie.writes[1]).toContain('Path=/app');
    expect(reload).toHaveBeenCalledOnce();
  });

  it('expires the legacy root cookie without inspecting sidebar storage on public routes', () => {
    const getItem = vi.fn(() => 'false');
    const cookie = sidebarCookieDocument('/', { root: 'true' });

    runInNewContext(SIDEBAR_PREFERENCE_BOOTSTRAP, {
      document: cookie.document,
      localStorage: { getItem },
      location: { pathname: '/', protocol: 'https:', reload: vi.fn() },
    });

    expect(cookie.read()).toEqual({ app: undefined, root: undefined });
    expect(cookie.writes).toHaveLength(1);
    expect(cookie.writes[0]).toContain('Path=/; Max-Age=0');
    expect(getItem).not.toHaveBeenCalled();
  });
});
