import { beforeEach, describe, expect, it, vi } from 'vitest';

const toast = vi.hoisted(() => ({
  loading: vi.fn(() => 'toast-1'),
  success: vi.fn(),
  error: vi.fn(),
}));

vi.mock('sonner', () => ({ toast }));

const { toastMutation } = await import('./mutation-toast.js');

describe('toastMutation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    toast.loading.mockReturnValue('toast-1');
  });

  it('replaces a loading toast with success when the mutation resolves', async () => {
    const result = await toastMutation(Promise.resolve({ ok: true }), {
      loading: 'Accepting proposal',
      success: 'Accepted Review planning workbook',
    });

    expect(result).toEqual({ ok: true });
    expect(toast.loading).toHaveBeenCalledWith('Accepting proposal');
    expect(toast.success).toHaveBeenCalledWith('Accepted Review planning workbook', {
      id: 'toast-1',
    });
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('replaces a loading toast with the mutation error copy', async () => {
    const result = await toastMutation(Promise.resolve({ error: 'Calendar conflict' }), {
      loading: 'Accepting proposal',
      success: 'Accepted',
    });

    expect(result).toEqual({ error: 'Calendar conflict' });
    expect(toast.error).toHaveBeenCalledWith('Calendar conflict', { id: 'toast-1' });
    expect(toast.success).not.toHaveBeenCalled();
  });
});
