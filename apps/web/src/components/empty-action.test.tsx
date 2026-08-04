// @vitest-environment happy-dom

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { EmptyAction } from '@/components/empty-action';

describe('EmptyAction', () => {
  it('keeps its recovery action keyboard-visible and linked to its destination', () => {
    render(
      <EmptyAction
        title="No tasks match this filter"
        body="Clear the filters or broaden the slice to see more work."
        href="/app/tasks"
        action="Clear filters"
      />,
    );

    const action = screen.getByRole('link', { name: 'Clear filters' });
    expect(action.getAttribute('href')).toBe('/app/tasks');
    expect(action.className).toContain('focus-visible:ring-2');
    expect(action.className).toContain('focus-visible:ring-border-strong');
    expect(action.className).toContain('focus-visible:ring-offset-bg');
    expect(action.className).toContain('forced-colors:focus-visible:outline');
    expect(action.className).toContain('forced-colors:focus-visible:outline-2');
  });
});
