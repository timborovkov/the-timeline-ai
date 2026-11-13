import { cleanup, render, screen } from '@testing-library/react';
import { expect, vi } from '@timeline/test-support';
import { afterEach, describe, it } from 'bun:test';

const fakes = vi.hoisted(() => ({ pathname: '/app/work' }));
await vi.mock(
  import.meta.resolve('next/navigation'),
  () => ({ usePathname: () => fakes.pathname }),
  () => import('next/navigation'),
);
const { WorkNavigation } = await import('@/components/work-subnav');
// Test environment: happy-dom

afterEach(cleanup);

describe('WorkNavigation', () => {
  it('preserves the navigation element across work destinations and selects nested views', () => {
    fakes.pathname = '/app/work';
    const { rerender } = render(<WorkNavigation />);
    const nav = screen.getByRole('navigation', { name: 'Work' });
    expect(screen.queryByRole('link', { name: 'Pinned' })).toBeNull();
    for (const [path, label] of [
      ['/app/objects/new', 'Objects'],
      ['/app/calendar', 'Calendar'],
      ['/app/approvals', 'Approvals'],
    ] as const) {
      fakes.pathname = path;
      rerender(<WorkNavigation />);
      expect(screen.getByRole('navigation', { name: 'Work' })).toBe(nav);
      expect(screen.getByRole('link', { name: label }).getAttribute('aria-current')).toBe('page');
    }
  });

  it('does not show Work tabs on unrelated workspace routes', () => {
    fakes.pathname = '/app/connections';
    render(<WorkNavigation />);
    expect(screen.queryByRole('navigation', { name: 'Work' })).toBeNull();
  });
});
