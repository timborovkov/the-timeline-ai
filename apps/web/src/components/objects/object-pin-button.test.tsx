// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fakes = vi.hoisted(() => ({
  pin: vi.fn(),
  unpin: vi.fn(),
}));

vi.mock('@/app/actions/pins', () => ({
  pinTargetAction: fakes.pin,
  unpinTargetAction: fakes.unpin,
}));

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

    fireEvent.click(screen.getByRole('button', { name: 'Pin' }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Unpin' })).toBeTruthy();
    });
    expect(fakes.pin).toHaveBeenCalledWith({ kind: 'object', key: 'object-1' });

    fireEvent.click(screen.getByRole('button', { name: 'Unpin' }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Pin' })).toBeTruthy();
    });
    expect(fakes.unpin).toHaveBeenCalledWith({ kind: 'object', key: 'object-1' });
  });
});
