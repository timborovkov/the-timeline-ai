// @vitest-environment happy-dom

import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const toast = vi.hoisted(() => ({
  loading: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  dismiss: vi.fn(),
}));

vi.mock('sonner', () => ({ toast }));

const { useFormActionToast } = await import('@/lib/form-action-toast');

function Probe(props: {
  id: string;
  pending: boolean;
  error?: string | null;
  success?: string | null;
  fieldError?: boolean;
}) {
  useFormActionToast(props);
  return null;
}

describe('useFormActionToast', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    toast.loading.mockReset();
    toast.success.mockReset();
    toast.error.mockReset();
    toast.dismiss.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('shows a delayed loading toast, then success', () => {
    const view = render(<Probe id="team-timezone" pending success="Timezone updated" />);
    vi.advanceTimersByTime(149);
    expect(toast.loading).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(toast.loading).toHaveBeenCalledWith('Saving changes…', {
      id: 'team-timezone',
      duration: Infinity,
    });

    view.rerender(<Probe id="team-timezone" pending={false} success="Timezone updated" />);
    expect(toast.success).toHaveBeenCalledWith('Timezone updated', {
      id: 'team-timezone',
      duration: 2_000,
    });
  });

  it('keeps field validation inline and dismisses a pending toast', () => {
    const view = render(<Probe id="team-timezone" pending />);
    vi.advanceTimersByTime(150);
    view.rerender(
      <Probe id="team-timezone" pending={false} error="Choose a valid timezone" fieldError />,
    );
    expect(toast.error).not.toHaveBeenCalled();
    expect(toast.dismiss).toHaveBeenCalledWith('team-timezone');
  });

  it('toasts a non-field server error', () => {
    render(
      <Probe id="team-timezone" pending={false} error="Only admins can update the timezone." />,
    );
    expect(toast.error).toHaveBeenCalledWith('Only admins can update the timezone.', {
      id: 'team-timezone',
      duration: 6_000,
    });
  });
});
