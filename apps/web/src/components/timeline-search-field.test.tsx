// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));

vi.mock('next/navigation', () => ({
  useRouter: () => router,
}));

const { DebouncedFilterForm } = await import('@/components/debounced-filter-form');
const { TimelineSearchField } = await import('./timeline-search-field.js');

describe('TimelineSearchField', () => {
  afterEach(() => {
    cleanup();
    router.push.mockReset();
    router.replace.mockReset();
  });

  it('opens global search with the typed query and current timeline filters', async () => {
    const user = userEvent.setup();
    render(<TimelineSearchField source="email" from="2026-08-01" to="2026-08-10" />);

    const search = screen.getByRole('searchbox', { name: 'Search timeline' });
    await user.type(search, 'northstar{Enter}');

    expect(router.push).toHaveBeenCalledOnce();
    expect(router.push).toHaveBeenCalledWith(
      '/app/search?q=northstar&source=email&from=2026-08-01&to=2026-08-10',
    );
  });

  it('does not navigate for an empty query', async () => {
    const user = userEvent.setup();
    render(<TimelineSearchField />);

    await user.type(screen.getByRole('searchbox', { name: 'Search timeline' }), '{Enter}');
    expect(router.push).not.toHaveBeenCalled();
  });

  it('does not submit the surrounding timeline filter form while typing', async () => {
    const user = userEvent.setup();
    render(
      <DebouncedFilterForm basePath="/app/timeline">
        <TimelineSearchField />
      </DebouncedFilterForm>,
    );

    await user.type(screen.getByRole('searchbox', { name: 'Search timeline' }), 'northstar');
    await new Promise((resolve) => setTimeout(resolve, 350));

    expect(router.replace).not.toHaveBeenCalled();
    expect(router.push).not.toHaveBeenCalled();
  });
});
