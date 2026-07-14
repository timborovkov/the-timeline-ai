// @vitest-environment happy-dom

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { WorkSubnav } from '@/components/work-subnav';

describe('WorkSubnav', () => {
  it('preserves every work destination and marks the current route', () => {
    render(<WorkSubnav current="/app/boards/board-1" />);

    expect(screen.getAllByRole('link')).toHaveLength(6);
    expect(screen.getByRole('link', { name: 'Boards' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('link', { name: 'Overview' }).hasAttribute('aria-current')).toBe(false);
  });
});
