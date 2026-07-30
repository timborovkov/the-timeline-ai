// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fakes = vi.hoisted(() => ({
  pathname: '/app/team/slack',
}));

vi.mock('next/navigation', () => ({
  usePathname: () => fakes.pathname,
}));

vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: ReactNode }) => children,
  TooltipContent: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => children,
}));

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
