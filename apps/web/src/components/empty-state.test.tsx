// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react';
import { Inbox } from 'lucide-react';
import { afterEach, describe, expect, it } from 'vitest';

import { EmptyState } from '@/components/empty-state';

afterEach(() => {
  cleanup();
});

describe('EmptyState', () => {
  it('keeps its recovery action keyboard-visible and linked to its destination', () => {
    render(
      <EmptyState
        icon={Inbox}
        title="No tasks match this filter"
        body="Clear the filters or broaden the slice to see more work."
        href="/app/tasks"
        action="Clear filters"
      />,
    );

    expect(screen.getByRole('status')).toBeTruthy();
    expect(screen.getByText('No tasks match this filter')).toBeTruthy();
    expect(
      screen.getByText('Clear the filters or broaden the slice to see more work.'),
    ).toBeTruthy();

    const action = screen.getByRole('link', { name: 'Clear filters' });
    expect(action.getAttribute('href')).toBe('/app/tasks');
    expect(action.className).toContain('focus-visible:ring-2');
    expect(action.className).toContain('focus-visible:ring-border-strong');
    expect(action.className).toContain('focus-visible:ring-offset-bg');
    expect(action.className).toContain('forced-colors:focus-visible:outline');
    expect(action.className).toContain('forced-colors:focus-visible:outline-2');
  });

  it('renders a waiting empty state without inventing an action', () => {
    render(
      <EmptyState
        icon={Inbox}
        title="No proposals to review"
        body="The timeline is collecting events. Proposals will appear here when something needs a decision."
      />,
    );

    expect(screen.getByRole('status')).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });
});
