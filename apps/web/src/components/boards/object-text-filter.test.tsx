// @vitest-environment happy-dom

// The shared board filter needs a reliably reachable clear action on every
// surface that reuses it, including narrow task-board layouts.
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ObjectTextFilter } from '@/components/boards/object-text-filter';

afterEach(cleanup);

describe('ObjectTextFilter', () => {
  it('clears an active query through a named 24px target and announces the filtered count', async () => {
    const user = userEvent.setup();
    const onQueryChange = vi.fn();

    render(
      <ObjectTextFilter
        query="launch"
        onQueryChange={onQueryChange}
        resultCount={2}
        totalCount={8}
      />,
    );

    expect(screen.getByRole('status').textContent).toBe('2 of 8');
    const input = screen.getByRole('searchbox', { name: 'Filter objects' });
    const clear = screen.getByRole('button', { name: 'Clear object filter' });
    expect(clear.className).toContain('size-6');
    expect(clear.className).toContain('focus-visible:ring-2');

    await user.tab();
    expect(document.activeElement).toBe(input);
    await user.tab();
    expect(document.activeElement).toBe(clear);

    await user.click(clear);

    expect(onQueryChange).toHaveBeenCalledWith('');
  });

  it('keeps the clear action out of the tab order until there is a query to clear', () => {
    render(<ObjectTextFilter query="" onQueryChange={vi.fn()} resultCount={8} totalCount={8} />);

    expect(screen.getByRole('status').textContent).toBe('8');
    expect(screen.queryByRole('button', { name: 'Clear object filter' })).toBeNull();
  });
});
