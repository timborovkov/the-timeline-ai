// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/components/work-subnav', () => ({
  WorkSubnav: ({ current }: { current: string }) => (
    <nav aria-label="Work navigation">{current}</nav>
  ),
}));

const { default: CalendarLoading } = await import('./loading.js');

afterEach(() => {
  cleanup();
});

describe('CalendarLoading', () => {
  it('announces calendar loading and mirrors its primary sections', () => {
    render(<CalendarLoading />);

    expect(screen.getByLabelText('Loading calendar').getAttribute('aria-busy')).toBe('true');
    expect(screen.getByRole('status').textContent).toContain('Loading calendar');
    expect(screen.getByRole('navigation', { name: 'Work navigation' }).textContent).toContain(
      '/app/calendar',
    );
    expect(screen.getByRole('region', { name: 'Calendar loading placeholder' })).toBeTruthy();
  });
});
