// @vitest-environment happy-dom

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { DueDateDisplay } from '@/components/due-date-display';
import { WorkspaceTimezoneProvider } from '@/components/workspace-timezone-context';

const NOW = new Date('2026-07-20T12:00:00.000Z');

function renderDue(
  value: Date | string | null,
  variant: 'stacked' | 'compact' | 'inline' | 'field-hint',
) {
  return render(
    <WorkspaceTimezoneProvider timezone="America/Los_Angeles">
      <DueDateDisplay value={value} variant={variant} now={NOW} locale="en-US" />
    </WorkspaceTimezoneProvider>,
  );
}

describe('DueDateDisplay', () => {
  it.each([
    ['stacked', 'OverdueJul 19, 2026'],
    ['compact', 'Overdue Jul 19, 2026'],
    ['inline', 'Overdue · Jul 19, 2026'],
    ['field-hint', 'Overdue · Jul 19, 2026'],
  ] as const)('renders the %s variant with state and exact date', (variant, text) => {
    const { container } = renderDue('2026-07-19T00:00:00.000Z', variant);
    expect(container.textContent).toBe(text);
    expect(container.querySelector('[data-due-status="overdue"]')?.className).toContain(
      'text-danger',
    );
  });

  it('renders missing dates explicitly', () => {
    renderDue(null, 'inline');
    expect(screen.getByText('No due date')).toBeTruthy();
  });

  it('preserves invalid external values visibly', () => {
    renderDue('not-a-date', 'compact');
    expect(screen.getByText('Due not-a-date')).toBeTruthy();
  });

  it('uses the workspace timezone for non-midnight timestamps', () => {
    const { container } = renderDue('2026-07-21T02:00:00.000Z', 'inline');
    expect(container.textContent).toBe('Due today · Jul 20, 2026');
  });
});
