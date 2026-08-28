// @vitest-environment happy-dom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fakes = vi.hoisted(() => ({
  pathname: '/app/timeline',
}));

vi.mock('next/navigation', () => ({
  usePathname: () => fakes.pathname,
}));

vi.mock('@/components/team-switcher', () => ({
  TeamSwitcher: () => createElement('div', null, 'Team switcher'),
}));

const { MobileNav } = await import('./mobile-nav.js');

const active = {
  teamId: 'team-1',
  teamName: 'AuditAI',
  teamSlug: 'auditai',
  role: 'admin' as const,
};

beforeEach(() => {
  fakes.pathname = '/app/timeline';
  document.body.style.overflow = '';
});

afterEach(() => {
  cleanup();
  document.body.style.overflow = '';
});

describe('MobileNav', () => {
  it('closes the drawer after opening Help in a new tab', async () => {
    const user = userEvent.setup();
    render(
      createElement(MobileNav, {
        active,
        memberships: [active],
        recipientInvites: [],
      }),
    );

    await user.click(screen.getByRole('button', { name: 'Open navigation' }));
    expect(screen.getByRole('dialog', { name: 'Navigation' })).toBeTruthy();
    expect(document.body.style.overflow).toBe('hidden');

    const helpLink = screen.getByRole('link', { name: 'Open Help & support in a new tab' });
    helpLink.addEventListener('click', (event) => {
      event.preventDefault();
    });
    await user.click(helpLink);

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Navigation' })).toBeNull();
    });
    expect(document.body.style.overflow).toBe('');
  });

  it('opens as a modal, focuses its close control, handles Escape, and restores focus', async () => {
    const user = userEvent.setup();
    render(
      createElement(MobileNav, {
        active,
        memberships: [active],
        recipientInvites: [],
      }),
    );

    const opener = screen.getByRole<HTMLButtonElement>('button', { name: 'Open navigation' });
    await user.click(opener);
    const dialog = screen.getByRole<HTMLDialogElement>('dialog', { name: 'Navigation' });
    expect(dialog.open).toBe(true);
    expect(opener.getAttribute('aria-haspopup')).toBe('dialog');
    expect(opener.getAttribute('aria-controls')).toBe('mobile-primary-navigation');
    const [backdropClose, closeControl] = screen.getAllByRole<HTMLButtonElement>('button', {
      name: 'Close navigation',
    });
    expect(backdropClose?.getAttribute('tabindex')).toBe('-1');
    expect(document.activeElement).toBe(closeControl);

    dialog.dispatchEvent(new Event('cancel', { bubbles: false, cancelable: true }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Navigation' })).toBeNull();
    });
    expect(document.activeElement).toBe(opener);
    expect(document.body.style.overflow).toBe('');
  });

  it('groups routes and exposes the current destination without relying on its color', async () => {
    const user = userEvent.setup();
    fakes.pathname = '/app/tasks';
    render(
      createElement(MobileNav, {
        active,
        memberships: [active],
        recipientInvites: [],
        badges: { work: 1 },
      }),
    );

    await user.click(screen.getByRole('button', { name: 'Open navigation' }));

    expect(screen.getByRole('list', { name: 'Overview' })).toBeTruthy();
    expect(screen.getByRole('list', { name: 'Workspace' })).toBeTruthy();
    expect(screen.getByRole('list', { name: 'Manage' })).toBeTruthy();
    expect(
      screen
        .getByRole('link', { name: 'Work, 1 item needs attention' })
        .getAttribute('aria-current'),
    ).toBe('page');
    expect(screen.getByRole('link', { name: 'Team' }).getAttribute('aria-current')).toBeNull();
  });

  it('keeps drawer navigation controls inside device safe areas', async () => {
    const user = userEvent.setup();
    render(
      createElement(MobileNav, {
        active,
        memberships: [active],
        recipientInvites: [],
      }),
    );

    await user.click(screen.getByRole('button', { name: 'Open navigation' }));

    const drawer = screen.getByRole('dialog', { name: 'Navigation' }).querySelector('aside');
    expect(drawer?.className).toContain('pl-[max(1rem,env(safe-area-inset-left))]');
    expect(drawer?.className).toContain('pr-[max(1rem,env(safe-area-inset-right))]');
  });
});
