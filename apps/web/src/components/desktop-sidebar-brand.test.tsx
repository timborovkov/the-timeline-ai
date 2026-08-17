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

    const homeLink = screen.getByRole('link', { name: 'The Timeline home' });
    expect(homeLink.getAttribute('href')).toBe('/app');
    expect([...homeLink.classList]).toEqual(expect.arrayContaining(['h-9', 'px-3']));
    expect([...screen.getByText('The Timeline').classList]).toEqual(
      expect.arrayContaining(['font-semibold', 'tracking-tight']),
    );
    expect(screen.getByText('The Timeline').classList).not.toContain('font-mono');
    expect(container.querySelectorAll('svg[viewBox="0 0 48 48"] rect')).toHaveLength(5);
    expect(container.textContent).not.toContain('▦');

    await user.click(screen.getByRole('button', { name: 'Collapse sidebar' }));

    expect(container.querySelector('span.text-sm.font-semibold')).toBeNull();
    const collapsedHomeLink = screen.getByRole('link', { name: 'The Timeline home' });
    expect(collapsedHomeLink.getAttribute('href')).toBe('/app');
    expect([...collapsedHomeLink.classList]).toEqual(expect.arrayContaining(['size-9']));
    expect(collapsedHomeLink.querySelectorAll('svg[viewBox="0 0 48 48"] rect')).toHaveLength(5);

    await user.hover(collapsedHomeLink);
    expect((await screen.findByRole('tooltip')).textContent).toBe('The Timeline');
  });

  it('uses a quiet chevron to fold and unfold the sidebar', async () => {
    const user = userEvent.setup();
    render(
      <TooltipProvider delayDuration={0}>
        <DesktopSidebar
          active={active}
          memberships={[active]}
          recipientInvites={[]}
          initialExpanded
        />
      </TooltipProvider>,
    );

    const collapse = screen.getByRole('button', { name: 'Collapse sidebar' });
    expect(collapse.querySelector('svg.lucide-chevron-left')).not.toBeNull();
    expect(collapse.querySelector('svg.lucide-panel-left-close')).toBeNull();

    await user.click(collapse);

    const expand = screen.getByRole('button', { name: 'Expand sidebar' });
    expect(expand.querySelector('svg.lucide-chevron-right')).not.toBeNull();
    expect(expand.querySelector('svg.lucide-panel-left-open')).toBeNull();
  });
});
