// @vitest-environment happy-dom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

const replace = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
}));

const { DebouncedFilterForm } = await import('./debounced-filter-form.js');

describe('DebouncedFilterForm', () => {
  afterEach(() => {
    cleanup();
    replace.mockReset();
  });

  it('reapplies the same filter after external navigation clears it', async () => {
    const user = userEvent.setup();
    const view = render(<FilterForm resetKey="initial" />);

    await user.type(screen.getByLabelText('Source'), 'slack');
    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith('/app/timeline?source=slack', { scroll: false });
    });

    view.rerender(<FilterForm resetKey="cleared-externally" />);
    await user.type(screen.getByLabelText('Source'), 'slack');

    await waitFor(() => {
      expect(replace).toHaveBeenCalledTimes(2);
    });
    expect(replace).toHaveBeenLastCalledWith('/app/timeline?source=slack', { scroll: false });
  });

  it('cancels pending filter navigation when a link outside the form is clicked', async () => {
    const user = userEvent.setup();
    render(<FilterForm resetKey="initial" />);

    await user.type(screen.getByLabelText('Source'), 'slack');
    await user.click(screen.getByRole('link', { name: 'Clear' }));
    await waitForDebounce();

    expect(replace).not.toHaveBeenCalled();
  });

  it('cancels pending filter navigation on browser history changes', async () => {
    const user = userEvent.setup();
    render(<FilterForm resetKey="initial" />);

    await user.type(screen.getByLabelText('Source'), 'slack');
    window.dispatchEvent(new PopStateEvent('popstate'));
    await waitForDebounce();

    expect(replace).not.toHaveBeenCalled();
  });
});

async function waitForDebounce(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 350));
}

function FilterForm({ resetKey }: { resetKey: string }) {
  return (
    <>
      <DebouncedFilterForm basePath="/app/timeline">
        <label>
          Source
          <input key={resetKey} name="source" defaultValue="" />
        </label>
      </DebouncedFilterForm>
      <a href="#clear">Clear</a>
    </>
  );
}
