// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/components/rail-nav', () => ({
  RailNav: () => createElement('nav', null, 'Primary navigation'),
}));

vi.mock('@/components/team-switcher', () => ({
  TeamSwitcher: () => createElement('div', null, 'Team switcher'),
}));

const { DesktopSidebar } = await import('./desktop-sidebar.js');
const { TooltipProvider } = await import('./ui/tooltip.js');

const active = {
  teamId: 'team-1',
  teamName: 'AuditAI',
  teamSlug: 'auditai',
  role: 'admin' as const,
};

afterEach(() => {
  cleanup();
});

describe('DesktopSidebar branding', () => {
  it('uses the canonical brand mark and wordmark in expanded and collapsed states', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <TooltipProvider delayDuration={0}>
        <DesktopSidebar
          active={active}
          memberships={[active]}
          recipientInvites={[]}
          initialExpanded
        />
      </TooltipProvider>,
    );

    expect([...screen.getByText('The Timeline').classList]).toEqual(
      expect.arrayContaining(['font-semibold', 'tracking-tight']),
    );
    expect(screen.getByText('The Timeline').classList).not.toContain('font-mono');
    expect(container.querySelectorAll('svg[viewBox="0 0 48 48"] rect')).toHaveLength(5);
    expect(container.textContent).not.toContain('▦');

    await user.click(screen.getByRole('button', { name: 'Collapse sidebar' }));

    expect(container.querySelector('span.text-sm.font-semibold')).toBeNull();
    const collapsedLogo = screen.getByRole('img', { name: 'The Timeline' });
    expect(container.querySelectorAll('svg[viewBox="0 0 48 48"] rect')).toHaveLength(5);

    await user.hover(collapsedLogo);
    expect((await screen.findByRole('tooltip')).textContent).toBe('The Timeline');
  });
});
