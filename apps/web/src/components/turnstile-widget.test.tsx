import { describe, expect, it, vi } from 'vitest';

import { renderTurnstileWidget } from '@/components/turnstile-widget';

describe('renderTurnstileWidget', () => {
  it('renders directly without using turnstile.ready', () => {
    const container = {} as HTMLElement;
    const reset = vi.fn();
    const ready = vi.fn();
    const turnstile = {
      ready,
      render: vi.fn(() => 'widget-1'),
      remove: vi.fn(),
      reset: vi.fn(),
    };

    expect(
      renderTurnstileWidget({
        action: 'signup',
        container,
        reset,
        siteKey: 'site-key',
        turnstile,
      }),
    ).toBe('widget-1');

    expect(ready).not.toHaveBeenCalled();
    expect(turnstile.render).toHaveBeenCalledWith(container, {
      sitekey: 'site-key',
      action: 'signup',
      theme: 'light',
      'error-callback': reset,
      'expired-callback': reset,
    });
  });
});
