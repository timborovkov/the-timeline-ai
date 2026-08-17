import { runInNewContext } from 'node:vm';

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type { TeamMembership } from '@/lib/active-team';
import type { ReactNode } from 'react';

import { DesktopSidebar } from '@/components/desktop-sidebar';
import { SIDEBAR_PREFERENCE_BOOTSTRAP, sidebarExpandedFromCookie } from '@/lib/sidebar-preference';

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
    expect(html).toContain('transition-[width] duration-200 motion-reduce:transition-none');
  });

  it('defaults to expanded unless the cookie explicitly stores false', () => {
    expect(sidebarExpandedFromCookie(undefined)).toBe(true);
    expect(sidebarExpandedFromCookie('true')).toBe(true);
    expect(sidebarExpandedFromCookie('false')).toBe(false);
  });

  it('migrates the existing local preference before rendering and reloads only once', () => {
    let cookie = '';
    const document = Object.defineProperty({}, 'cookie', {
      get: () => cookie,
      set: (value: string) => {
        cookie = value.split(';')[0] ?? '';
      },
    });
    const reload = vi.fn();
    const context = {
      document,
      localStorage: { getItem: () => 'false' },
      location: { protocol: 'https:', reload },
    };

    runInNewContext(SIDEBAR_PREFERENCE_BOOTSTRAP, context);
    runInNewContext(SIDEBAR_PREFERENCE_BOOTSTRAP, context);

    expect(cookie).toBe('timeline_sidebar_expanded=false');
    expect(reload).toHaveBeenCalledOnce();
  });

  it('keeps an existing cookie when local storage is stale', () => {
    let cookie = 'timeline_sidebar_expanded=true';
    const document = Object.defineProperty({}, 'cookie', {
      get: () => cookie,
      set: (value: string) => {
        cookie = value.split(';')[0] ?? '';
      },
    });
    const reload = vi.fn();

    runInNewContext(SIDEBAR_PREFERENCE_BOOTSTRAP, {
      document,
      localStorage: { getItem: () => 'false' },
      location: { protocol: 'https:', reload },
    });

    expect(cookie).toBe('timeline_sidebar_expanded=true');
    expect(reload).not.toHaveBeenCalled();
  });
});
