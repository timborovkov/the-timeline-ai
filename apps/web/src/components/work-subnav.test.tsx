import { render, screen } from '@testing-library/react';
import { expect } from '@timeline/test-support';
import { describe, it } from 'bun:test';

import { WorkSubnav } from '@/components/work-subnav';
// Test environment: happy-dom

describe('WorkSubnav', () => {
  it('preserves every work destination and marks the current route', () => {
    render(<WorkSubnav current="/app/boards/board-1" />);

    expect(screen.getAllByRole('link')).toHaveLength(8);
    expect(screen.getByRole('link', { name: 'Digests' }).getAttribute('href')).toBe('/app/digests');
    expect(screen.getByRole('link', { name: 'Pinned' }).getAttribute('href')).toBe(
      '/app/work?view=pinned',
    );
    expect(screen.getByRole('link', { name: 'Boards' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('link', { name: 'Overview' }).hasAttribute('aria-current')).toBe(false);
  });
});
