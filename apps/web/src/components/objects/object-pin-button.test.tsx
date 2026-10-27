import { expect } from '@timeline/test-support';
import { vi } from '@timeline/test-support';
import { afterEach, beforeEach, describe, it } from 'bun:test';
// Test environment: happy-dom

const fakes = vi.hoisted(() => ({
  pin: vi.fn(),
  unpin: vi.fn(),
}));

await vi.mock(
  import.meta.resolve('@/app/actions/pins'),
  () => ({
    pinTargetAction: fakes.pin,
    unpinTargetAction: fakes.unpin,
  }),
  () => import('@/app/actions/pins'),
);
await vi.mock(
  import.meta.resolve('next/navigation'),
  async () => ({
    ...(await import('next/navigation')),
    useRouter: () => ({ refresh: vi.fn() }),
  }),
  () => import('next/navigation'),
);

const { cleanup, fireEvent, render, screen, waitFor } = await import('@testing-library/react');

const { ObjectPinButton } = await import('@/components/objects/object-pin-button');

describe('ObjectPinButton', () => {
  beforeEach(() => {
    fakes.pin.mockReset().mockResolvedValue({ ok: true });
    fakes.unpin.mockReset().mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    cleanup();
  });

  it('pins and unpins the same object', async () => {
    render(<ObjectPinButton objectId="object-1" initialPinned={false} />);

    fireEvent.click(screen.getByRole('button', { name: 'Pin to Home' }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Unpin from Home' })).toBeTruthy();
    });
    expect(fakes.pin).toHaveBeenCalledWith({ kind: 'object', key: 'object-1' });

    fireEvent.click(screen.getByRole('button', { name: 'Unpin from Home' }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Pin to Home' })).toBeTruthy();
    });
    expect(fakes.unpin).toHaveBeenCalledWith({ kind: 'object', key: 'object-1' });
  });
});
