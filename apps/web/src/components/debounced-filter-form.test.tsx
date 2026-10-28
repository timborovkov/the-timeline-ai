import { expect } from '@timeline/test-support';
import { vi } from '@timeline/test-support';
import { afterEach, describe, it } from 'bun:test';
// Test environment: happy-dom

const replace = vi.hoisted(() => vi.fn());

await vi.mock(
  import.meta.resolve('next/navigation'),
  async () => ({
    ...(await import('next/navigation')),
    useRouter: () => ({ replace }),
  }),
  () => import('next/navigation'),
);

const { cleanup, render, screen, waitFor } = await import('@testing-library/react');
const { default: userEvent } = await import('@testing-library/user-event');

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

  it('retains pending filter values when a popover unmounts its controls', async () => {
    const user = userEvent.setup();
    const view = render(<FilterForm resetKey="initial" />);

    await user.type(screen.getByLabelText('Source'), 'slack');
    view.rerender(<FilterForm resetKey="initial" showFilters={false} />);
    expect(screen.queryByLabelText('Source')).toBeNull();

    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith('/app/timeline?source=slack', { scroll: false });
    });
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

function FilterForm({ resetKey, showFilters = true }: { resetKey: string; showFilters?: boolean }) {
  return (
    <>
      <DebouncedFilterForm basePath="/app/timeline">
        {showFilters ? (
          <label>
            Source
            <input key={resetKey} name="source" defaultValue="" />
          </label>
        ) : null}
      </DebouncedFilterForm>
      <a href="#clear">Clear</a>
    </>
  );
}
