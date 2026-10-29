import { expect } from '@timeline/test-support';
import { vi } from '@timeline/test-support';
import { afterEach, describe, it } from 'bun:test';
// Test environment: happy-dom

await vi.mock(
  import.meta.resolve('next/navigation'),
  async () => ({
    ...(await import('next/navigation')),
    useRouter: () => ({ back: vi.fn(), refresh: vi.fn() }),
  }),
  () => import('next/navigation'),
);
await vi.mock(
  import.meta.resolve('@/components/objects/object-merge-form'),
  () => ({
    ObjectMergeForm: () => null,
  }),
  () => import('@/components/objects/object-merge-form'),
);

const { cleanup, render, screen, within } = await import('@testing-library/react');
const { default: MergeObjectModalLoading } =
  await import('@/app/app/@modal/(.)objects/merge/loading');

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
