import { expect } from '@timeline/test-support';
import { vi } from '@timeline/test-support';
import { describe, it } from 'bun:test';

import type { TeamMembership } from '@/lib/active-team';
import type { ReactNode } from 'react';
await vi.mock(
  import.meta.resolve('@/components/app-document-scroll-lock'),
  () => ({
    AppDocumentScrollLock: () =>
      createElement('div', { 'data-testid': 'app-document-scroll-lock' }),
  }),
  () => import('@/components/app-document-scroll-lock'),
);

await vi.mock(
  import.meta.resolve('@/components/chat/chat-view-context'),
  () => ({
    ChatViewProvider: ({ children }: { children: ReactNode }) =>
      createElement('div', { 'data-testid': 'chat-view-provider' }, children),
  }),
  () => import('@/components/chat/chat-view-context'),
);
await vi.mock(
  import.meta.resolve('@/components/chat/floating-agent-chat'),
  () => ({
    FloatingAgentChat: () => createElement('div', { 'data-testid': 'floating-agent-chat' }),
  }),
  () => import('@/components/chat/floating-agent-chat'),
);

await vi.mock(
  import.meta.resolve('@/components/app-shell-scroll-restoration'),
  () => ({
    AppMainScrollRestoration: () => null,
  }),
  () => import('@/components/app-shell-scroll-restoration'),
);

await vi.mock(
  import.meta.resolve('@/components/desktop-sidebar'),
  () => ({
    DesktopSidebar: ({ initialExpanded }: { initialExpanded: boolean }) =>
      createElement('aside', {
        'data-testid': 'desktop-sidebar',
        'data-expanded': initialExpanded,
      }),
  }),
  () => import('@/components/desktop-sidebar'),
);

await vi.mock(
  import.meta.resolve('@/components/global-search-palette'),
  () => ({
    GlobalSearchPalette: () => createElement('div', { 'data-testid': 'global-search-palette' }),
  }),
  () => import('@/components/global-search-palette'),
);

await vi.mock(
  import.meta.resolve('@/components/inbox/inbox-bell'),
  () => ({
    InboxBell: () => createElement('button', { type: 'button' }, 'Inbox'),
  }),
  () => import('@/components/inbox/inbox-bell'),
);

await vi.mock(
  import.meta.resolve('@/components/inspector-context'),
  () => ({
    InspectorProvider: ({ children }: { children: ReactNode }) =>
      createElement('div', { 'data-testid': 'inspector-provider' }, children),
  }),
  () => import('@/components/inspector-context'),
);

await vi.mock(
  import.meta.resolve('@/components/inspector-pane'),
  () => ({
    InspectorPane: () => createElement('aside', { 'data-testid': 'inspector-pane' }),
    InspectorToggle: () => createElement('button', { type: 'button' }, 'Inspector'),
  }),
  () => import('@/components/inspector-pane'),
);

await vi.mock(
  import.meta.resolve('@/components/mobile-nav'),
  () => ({
    MobileNav: () => createElement('button', { type: 'button' }, 'Menu'),
  }),
  () => import('@/components/mobile-nav'),
);

await vi.mock(
  import.meta.resolve('@/components/team-setup-checklist-chip'),
  () => ({
    TeamSetupChecklistChip: () => null,
  }),
  () => import('@/components/team-setup-checklist-chip'),
);

await vi.mock(
  import.meta.resolve('@/components/theme-toggle'),
  () => ({
    ThemeToggle: () => createElement('button', { type: 'button' }, 'Theme'),
  }),
  () => import('@/components/theme-toggle'),
);

await vi.mock(
  import.meta.resolve('@/components/ui/tooltip'),
  () => ({
    TooltipProvider: ({ children }: { children: ReactNode }) =>
      createElement('div', { 'data-testid': 'tooltip-provider' }, children),
  }),
  () => import('@/components/ui/tooltip'),
);

await vi.mock(
  import.meta.resolve('@/components/user-menu'),
  () => ({
    UserMenu: () => createElement('button', { type: 'button' }, 'User'),
  }),
  () => import('@/components/user-menu'),
);

const { createElement } = await import('react');
const { renderToStaticMarkup } = await import('react-dom/server');
const { AppShell } = await import('@/components/app-shell');

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
        workspaceTimezone="America/Los_Angeles"
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
    expect(html).toContain(
      'data-slot="app-page-container" class="app-page-container mx-auto w-full max-w-6xl"',
    );
    expect(html).toContain('data-testid="floating-agent-chat"');
  });
});
