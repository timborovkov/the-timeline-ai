// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import ApprovalsError from '@/app/app/approvals/error';
import ApprovalsLoading from '@/app/app/approvals/loading';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Approvals route states', () => {
  it('retains approval and Work context and lets keyboard users retry a failed load', async () => {
    const user = userEvent.setup();
    const reset = vi.fn();

    render(<ApprovalsError error={new Error('route failed')} reset={reset} />);

    expect(screen.getAllByRole('heading', { level: 1, name: 'Approvals' })).toHaveLength(1);
    expect(
      screen.getByText('Review evidence-backed changes before they become team memory.'),
    ).toBeTruthy();
    expect(screen.getByRole('navigation', { name: 'Work' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Approvals' }).getAttribute('aria-current')).toBe(
      'page',
    );
    expect(
      screen.getByRole('heading', { level: 2, name: 'Unable to load approvals' }),
    ).toBeTruthy();
    expect(
      screen.getByText(
        'No approval has been accepted, changed, or rejected. Check your connection, then try again.',
      ),
    ).toBeTruthy();

    const retry = screen.getByRole('button', { name: 'Try again' });
    retry.focus();
    await user.keyboard('{Enter}');

    expect(reset).toHaveBeenCalledOnce();
  });

  it('announces loading while retaining the route heading, Work navigation, and list shape', () => {
    render(<ApprovalsLoading />);

    expect(screen.getByRole('status').textContent).toBe('Loading approvals');
    expect(screen.getByLabelText('Loading approvals').getAttribute('aria-busy')).toBe('true');
    expect(screen.getAllByRole('heading', { level: 1, name: 'Approvals' })).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'Approvals' }).getAttribute('aria-current')).toBe(
      'page',
    );
    expect(screen.getByRole('region', { name: 'Approvals loading placeholder' })).toBeTruthy();
  });

  it('keeps the loading skeleton free of interactive approval actions', () => {
    render(<ApprovalsLoading />);

    expect(screen.queryByRole('button')).toBeNull();
  });
});
