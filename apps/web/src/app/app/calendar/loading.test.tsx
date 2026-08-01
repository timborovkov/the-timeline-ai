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
  it('keeps calendar context available while hiding the visual placeholder', () => {
    render(<CalendarLoading />);

    expect(screen.getByLabelText('Loading calendar').getAttribute('aria-busy')).toBe('true');
    expect(screen.getByRole('status').textContent).toContain('Loading calendar');
    expect(screen.getByRole('heading', { level: 1, name: 'Calendar' })).toBeTruthy();
    expect(screen.getByRole('navigation', { name: 'Work navigation' }).textContent).toContain(
      '/app/calendar',
    );
    expect(screen.queryByRole('region', { name: 'Calendar loading placeholder' })).toBeNull();
    const visualPlaceholders = document.querySelectorAll('[aria-hidden="true"]');
    expect(visualPlaceholders.length).toBeGreaterThan(0);
    for (const visualPlaceholder of visualPlaceholders) {
      expect(visualPlaceholder.querySelectorAll('a, button, input, select, textarea')).toHaveLength(
        0,
      );
    }
  });
});
