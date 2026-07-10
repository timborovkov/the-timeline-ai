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

    await user.click(screen.getByRole('link', { name: 'Open help docs in a new tab' }));

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
    const closeControls = screen.getAllByRole<HTMLButtonElement>('button', {
      name: 'Close navigation',
    });
    expect(document.activeElement).toBe(closeControls.at(-1));

    dialog.dispatchEvent(new Event('cancel', { bubbles: false, cancelable: true }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Navigation' })).toBeNull());
    expect(document.activeElement).toBe(opener);
    expect(document.body.style.overflow).toBe('');
  });
});
