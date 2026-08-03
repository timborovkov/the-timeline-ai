// @vitest-environment happy-dom

import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ back: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('@/components/objects/object-merge-form', () => ({
  ObjectMergeForm: () => null,
}));

import MergeObjectModalLoading from '@/app/app/@modal/(.)objects/merge/loading';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('intercepted merge loading portal', () => {
  it('keeps the loading announcement inside the Radix dialog portal', () => {
    const { container } = render(
      <main>
        <h1>Objects</h1>
        <MergeObjectModalLoading />
      </main>,
    );

    const dialog = screen.getByRole('dialog', { name: 'Review merge' });
    const announcement = within(dialog).getByRole('status');

    expect(announcement.textContent).toBe('Loading merge preview');
    expect(container.contains(announcement)).toBe(false);
    expect(document.body.contains(announcement)).toBe(true);
  });
});
