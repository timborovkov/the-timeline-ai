import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { expect, vi } from '@timeline/test-support';
import { afterEach, describe, it } from 'bun:test';

const refresh = vi.fn();
const router = { refresh };
await vi.mock(
  import.meta.resolve('next/navigation'),
  async () => ({ ...(await import('next/navigation')), useRouter: () => router }),
  () => import('next/navigation'),
);
const { BillingCheckoutStatus } = await import('@/components/billing-checkout-status');

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  refresh.mockClear();
});

describe('Checkout return status', () => {
  it('waits for persisted activation, bounds polling and provides manual retry', () => {
    const interval = setInterval(() => undefined, 60000);
    let tick: (() => void) | undefined;
    vi.spyOn(window, 'setInterval').mockImplementation((callback) => {
      tick = callback;
      return interval;
    });
    const clear = vi.spyOn(window, 'clearInterval');
    const view = render(<BillingCheckoutStatus active={false} planName="Free" />);
    expect(view.getByRole('status').textContent).toContain('Waiting for your plan');
    act(() => {
      for (let i = 0; i < 10; i++) tick?.();
    });
    expect(refresh).toHaveBeenCalledTimes(10);
    expect(clear).toHaveBeenCalledWith(interval);
    expect(view.getByRole('status').textContent).toContain('not been confirmed');
    fireEvent.click(view.getByRole('button', { name: 'Check again' }));
    expect(refresh).toHaveBeenCalledTimes(11);
    view.rerender(<BillingCheckoutStatus active planName="Pay as you go" />);
    expect(view.getByRole('status').textContent).toContain('Pay as you go is active');
    expect(view.queryByRole('button')).toBeNull();
  });

  it('removes the unused session token while preserving the checkout return hint', () => {
    window.history.replaceState(
      {},
      '',
      '/app/team?section=billing&checkout=success&customer_session_token=synthetic',
    );
    render(<BillingCheckoutStatus active planName="Pay as you go" />);
    expect(window.location.search).not.toContain('customer_session_token');
    expect(window.location.search).toContain('checkout=success');
  });
});
