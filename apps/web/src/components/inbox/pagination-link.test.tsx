// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { InboxPaginationLink } from '@/components/inbox/pagination-link';

afterEach(() => {
  cleanup();
});

describe('InboxPaginationLink', () => {
  it('renders an unavailable page as non-interactive text', () => {
    render(
      <InboxPaginationLink disabled href="/app/inbox">
        Previous
      </InboxPaginationLink>,
    );

    expect(screen.queryByRole('link', { name: 'Previous' })).toBeNull();
    expect(screen.getByText('Previous').getAttribute('aria-disabled')).toBe('true');
  });

  it('keeps available pages as navigable links', () => {
    render(
      <InboxPaginationLink disabled={false} href="/app/inbox?page=2">
        Next
      </InboxPaginationLink>,
    );

    expect(screen.getByRole('link', { name: 'Next' }).getAttribute('href')).toBe(
      '/app/inbox?page=2',
    );
  });
});
