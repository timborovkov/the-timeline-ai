import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type { TeamMembership } from '@/lib/active-team';
import type { ReactNode } from 'react';

import { AppShell } from '@/components/app-shell';

vi.mock('@/components/app-document-scroll-lock', () => ({
  AppDocumentScrollLock: () => createElement('div', { 'data-testid': 'app-document-scroll-lock' }),
}));

vi.mock('@/components/chat/floating-agent-chat', () => ({
  FloatingAgentChat: () => createElement('div', { 'data-testid': 'floating-agent-chat' }),
}));

vi.mock('@/components/app-shell-scroll-restoration', () => ({
  AppMainScrollRestoration: () => null,
}));

vi.mock('@/components/desktop-sidebar', () => ({
  DesktopSidebar: ({ initialExpanded }: { initialExpanded: boolean }) =>
    createElement('aside', {
      'data-testid': 'desktop-sidebar',
      'data-expanded': initialExpanded,
    }),
}));

vi.mock('@/components/global-search-palette', () => ({
  GlobalSearchPalette: () => createElement('div', { 'data-testid': 'global-search-palette' }),
}));

vi.mock('@/components/inbox/inbox-bell', () => ({
  InboxBell: () => createElement('button', { type: 'button' }, 'Inbox'),
}));

vi.mock('@/components/inspector-context', () => ({
  InspectorProvider: ({ children }: { children: ReactNode }) =>
    createElement('div', { 'data-testid': 'inspector-provider' }, children),
}));

vi.mock('@/components/inspector-pane', () => ({
  InspectorPane: () => createElement('aside', { 'data-testid': 'inspector-pane' }),
  InspectorToggle: () => createElement('button', { type: 'button' }, 'Inspector'),
}));

vi.mock('@/components/mobile-nav', () => ({
  MobileNav: () => createElement('button', { type: 'button' }, 'Menu'),
}));

vi.mock('@/components/theme-toggle', () => ({
  ThemeToggle: () => createElement('button', { type: 'button' }, 'Theme'),
}));

vi.mock('@/components/ui/tooltip', () => ({
  TooltipProvider: ({ children }: { children: ReactNode }) =>
    createElement('div', { 'data-testid': 'tooltip-provider' }, children),
}));

vi.mock('@/components/user-menu', () => ({
  UserMenu: () => createElement('button', { type: 'button' }, 'User'),
}));

describe('AppShell', () => {
  const active: TeamMembership = {
    teamId: 'team-1',
    teamName: 'AuditAI',
    teamSlug: 'auditai',
    role: 'owner',
  };

  it('contains page scrolling inside the app viewport', () => {
    const html = renderToStaticMarkup(
      <AppShell
        active={active}
        memberships={[active]}
        recipientInvites={[]}
        user={{ name: 'Tim', email: 'tim@example.com' }}
        sidebarInitiallyExpanded={false}
      >
        <div>Page content</div>
      </AppShell>,
    );

    expect(html).toContain('flex h-dvh w-full overflow-hidden bg-bg');
    expect(html).toContain('data-testid="app-document-scroll-lock"');
    expect(html).toContain('data-testid="desktop-sidebar" data-expanded="false"');
    expect(html).toContain('flex min-h-0 min-w-0 flex-1 flex-col');
    expect(html).toContain(
      'min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-24 pt-6 md:px-8 md:py-8',
    );
  });
});
