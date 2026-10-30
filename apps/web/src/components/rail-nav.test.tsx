import { expect } from '@timeline/test-support';
import { vi } from '@timeline/test-support';
import { afterEach, beforeEach, describe, it } from 'bun:test';

import type { ReactNode } from 'react';
// Test environment: happy-dom

const fakes = vi.hoisted(() => ({
  pathname: '/app/team/slack',
}));

await vi.mock(
  import.meta.resolve('next/navigation'),
  async () => ({
    ...(await import('next/navigation')),
    usePathname: () => fakes.pathname,
  }),
  () => import('next/navigation'),
);

await vi.mock(
  import.meta.resolve('@/components/ui/tooltip'),
  () => ({
    Tooltip: ({ children }: { children: ReactNode }) => children,
    TooltipContent: ({ children }: { children: ReactNode }) => <span>{children}</span>,
    TooltipTrigger: ({ children }: { children: ReactNode }) => children,
  }),
  () => import('@/components/ui/tooltip'),
);

const { cleanup, render, screen } = await import('@testing-library/react');

const { createElement } = await import('react');

const { RailNav } = await import('./rail-nav.js');

beforeEach(() => {
  fakes.pathname = '/app/team/slack';
});

afterEach(() => {
  cleanup();
});

describe('RailNav', () => {
  it('groups desktop routes and marks only the owning parent as current', () => {
    render(createElement(RailNav, { role: 'member', expanded: true, badges: { connections: 2 } }));

    expect(screen.getByRole('navigation', { name: 'Primary' }).getAttribute('id')).toBe(
      'desktop-primary-navigation',
    );
    expect(screen.getByRole('list', { name: 'Overview' })).toBeTruthy();
    expect(screen.getByRole('list', { name: 'Workspace' })).toBeTruthy();
    expect(screen.getByRole('list', { name: 'Manage' })).toBeTruthy();
    expect(
      screen
        .getByRole('link', { name: 'Connections, 2 items need attention' })
        .getAttribute('aria-current'),
    ).toBe('page');
    expect(screen.getByRole('link', { name: 'Team' }).getAttribute('aria-current')).toBeNull();
  });

  it('keeps hierarchy available to assistive technology in the collapsed rail', () => {
    render(createElement(RailNav, { role: 'member', expanded: false }));

    expect(screen.getByRole('list', { name: 'Overview' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Connections' }).getAttribute('aria-current')).toBe(
      'page',
    );
    expect(screen.queryByText('Overview')).toBeNull();
  });
});
