// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fakes = vi.hoisted(() => ({
  useOnboardingChecklistQuery: vi.fn(),
  pathname: '/app/sources',
}));

vi.mock('next/navigation', () => ({
  usePathname: () => fakes.pathname,
}));

vi.mock('@/lib/use-paginated-queries', () => ({
  useOnboardingChecklistQuery: fakes.useOnboardingChecklistQuery,
}));

const { TeamSetupChecklistChip } = await import('./team-setup-checklist-chip.js');

beforeEach(() => {
  vi.clearAllMocks();
  fakes.pathname = '/app/sources';
});

afterEach(() => {
  cleanup();
});

describe('TeamSetupChecklistChip', () => {
  it('links back to the Home checklist when setup is still open', () => {
    fakes.useOnboardingChecklistQuery.mockReturnValue({
      isPending: false,
      data: {
        dismissed: false,
        items: [
          { key: 'first_note', completed: true },
          { key: 'invite_teammate', completed: false },
        ],
      },
    });

    render(<TeamSetupChecklistChip />);

    expect(
      screen.getByRole('link', { name: 'Team setup checklist 1/2' }).getAttribute('href'),
    ).toBe('/app#team-setup-checklist-panel');
  });

  it('stays hidden on Home, after hide, and when every step is done', () => {
    fakes.useOnboardingChecklistQuery.mockReturnValue({
      isPending: false,
      data: {
        dismissed: false,
        items: [
          { key: 'first_note', completed: true },
          { key: 'invite_teammate', completed: false },
        ],
      },
    });
    fakes.pathname = '/app';
    const { rerender } = render(<TeamSetupChecklistChip />);
    expect(screen.queryByRole('link')).toBeNull();

    fakes.pathname = '/app/chat';
    fakes.useOnboardingChecklistQuery.mockReturnValue({
      isPending: false,
      data: { dismissed: true, items: [{ key: 'first_note', completed: false }] },
    });
    rerender(<TeamSetupChecklistChip />);
    expect(screen.queryByRole('link')).toBeNull();

    fakes.useOnboardingChecklistQuery.mockReturnValue({
      isPending: false,
      data: { dismissed: false, items: [{ key: 'first_note', completed: true }] },
    });
    rerender(<TeamSetupChecklistChip />);
    expect(screen.queryByRole('link')).toBeNull();
  });
});
