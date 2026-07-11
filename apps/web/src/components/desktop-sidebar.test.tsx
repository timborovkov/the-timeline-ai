// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ReactNode } from 'react';

vi.mock('@/components/rail-nav', () => ({
  RailNav: () => createElement('nav', null, 'Primary navigation'),
}));

vi.mock('@/components/team-switcher', () => ({
  TeamSwitcher: () => createElement('div', null, 'Team switcher'),
}));

vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: ReactNode }) => createElement('div', null, children),
  TooltipContent: ({ children }: { children: ReactNode }) => createElement('div', null, children),
  TooltipTrigger: ({ children }: { children: ReactNode }) => createElement('div', null, children),
}));

const { DesktopSidebar } = await import('./desktop-sidebar.js');

const active = {
  teamId: 'team-1',
  teamName: 'AuditAI',
  teamSlug: 'auditai',
  role: 'admin' as const,
};

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
});

describe('DesktopSidebar', () => {
  it('uses the canonical brand mark and wordmark in expanded and collapsed states', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <DesktopSidebar active={active} memberships={[active]} recipientInvites={[]} />,
    );

    expect([...screen.getByText('THE TIMELINE').classList]).toEqual(
      expect.arrayContaining(['font-mono', 'font-bold', 'tracking-[0.18em]']),
    );
    expect(container.querySelectorAll('svg[viewBox="0 0 48 48"] rect')).toHaveLength(5);
    expect(container.textContent).not.toContain('▦');

    await user.click(screen.getByRole('button', { name: 'Collapse sidebar' }));

    expect(screen.queryByText('THE TIMELINE')).toBeNull();
    expect(screen.getByRole('img', { name: 'The Timeline' })).toBeTruthy();
    expect(container.querySelectorAll('svg[viewBox="0 0 48 48"] rect')).toHaveLength(5);
  });
});
