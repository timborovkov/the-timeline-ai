// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import BoardDetailLoading from '@/app/app/boards/[id]/loading';
import BoardsLoading from '@/app/app/boards/loading';

afterEach(() => {
  cleanup();
});

describe('Boards loading states', () => {
  it('announces both list and detail loading states', () => {
    const { rerender } = render(<BoardsLoading />);

    expect(screen.getByRole('status').textContent).toContain('Loading boards');
    expect(screen.getByRole('status').parentElement?.getAttribute('aria-busy')).toBeNull();
    expect(screen.getByLabelText('Loading boards').parentElement?.getAttribute('aria-busy')).toBe(
      'true',
    );

    rerender(<BoardDetailLoading />);

    expect(screen.getByRole('status').textContent).toContain('Loading board');
    expect(screen.getByRole('status').parentElement?.getAttribute('aria-busy')).toBeNull();
    expect(screen.getByRole('status').nextElementSibling?.getAttribute('aria-busy')).toBe('true');
  });
});
