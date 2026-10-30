import { render, screen } from '@testing-library/react';
import { expect } from '@timeline/test-support';
import { describe, it } from 'bun:test';

import { StatusBadge } from '@/components/status-badge';
import { statusLabel } from '@/lib/status-labels';
// Test environment: happy-dom

describe('StatusBadge', () => {
  it('maps enum values to sentence-case labels', () => {
    expect(statusLabel('in_progress')).toBe('In progress');
    expect(statusLabel('needs_attention')).toBe('Needs attention');
    expect(statusLabel('specific_users')).toBe('Specific users');
    render(<StatusBadge status="in_progress" />);
    expect(screen.getByText('In progress')).toBeTruthy();
  });

  it('reserves danger treatment for danger states', () => {
    const { container, rerender } = render(<StatusBadge status="failed" />);
    expect(container.firstElementChild?.className).toContain('text-danger');
    rerender(<StatusBadge status="pending" />);
    expect(container.firstElementChild?.className).not.toContain('text-danger');
  });
});
