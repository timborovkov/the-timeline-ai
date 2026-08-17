import { isValidElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { UndoToastButton } from '@/components/ui/undo-toast-button';

const toast = vi.hoisted(() => ({
  loading: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));

vi.mock('sonner', () => ({ toast }));

const {
  displayActionError,
  notifyAction,
  notifyError,
  notifySuccess,
  resetNotifyActionState,
  ACTION_TOAST_LOADING_DELAY_MS,
} = await import('@/lib/notify');

describe('displayActionError', () => {
  it('keeps sentence-like action errors and rejects codes, UUIDs, and raw Update failed', () => {
    expect(displayActionError('2 of 3 updates failed.', 'Couldn’t update items')).toBe(
      '2 of 3 updates failed.',
    );
    expect(
      displayActionError('Only an admin can do this. Ask a team admin to help.', 'Couldn’t sync'),
    ).toBe('Only an admin can do this. Ask a team admin to help.');
    expect(displayActionError('failed', 'Couldn’t retry failed jobs')).toBe(
      'Couldn’t retry failed jobs',
    );
    expect(displayActionError('partial', 'Couldn’t retry failed jobs')).toBe(
      'Couldn’t retry failed jobs',
    );
    expect(displayActionError('request_failed', 'Couldn’t sync integration')).toBe(
      'Couldn’t sync integration',
    );
    expect(displayActionError('Update failed', 'Couldn’t update status')).toBe(
      'Couldn’t update status',
    );
    expect(
      displayActionError('11111111-1111-4111-8111-111111111111', 'Couldn’t update status'),
    ).toBe('Couldn’t update status');
  });
});

describe('notifyAction', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    toast.loading.mockReset();
    toast.success.mockReset();
    toast.error.mockReset();
    resetNotifyActionState();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('skips the spinner when the request finishes before the loading delay', async () => {
    const run = vi.fn().mockResolvedValue({ ok: true });
    const pending = notifyAction({
      id: 'object:1',
      loading: 'Updating status…',
      success: 'Status updated',
      error: 'Couldn’t update status',
      run,
    });

    await vi.advanceTimersByTimeAsync(ACTION_TOAST_LOADING_DELAY_MS - 1);
    expect(toast.loading).not.toHaveBeenCalled();
    await pending;

    expect(toast.success).toHaveBeenCalledWith('Status updated', {
      id: 'object:1',
      duration: 2_000,
      action: undefined,
    });
    expect(toast.loading).not.toHaveBeenCalled();
  });

  it('shows a delayed loading toast and morphs it to success with undo', async () => {
    let resolveRun: (value: { ok: true }) => void = () => undefined;
    const run = vi.fn(
      () =>
        new Promise<{ ok: true }>((resolve) => {
          resolveRun = resolve;
        }),
    );
    const undoRun = vi.fn().mockResolvedValue({ ok: true });
    const pending = notifyAction({
      id: 'object:1',
      loading: 'Updating status…',
      success: 'Status updated',
      error: 'Couldn’t update status',
      run,
      undo: { run: undoRun },
    });

    await vi.advanceTimersByTimeAsync(ACTION_TOAST_LOADING_DELAY_MS);
    expect(toast.loading).toHaveBeenCalledWith('Updating status…', {
      id: 'object:1',
      duration: Infinity,
    });

    resolveRun({ ok: true });
    await pending;

    const successOptions = toast.success.mock.calls[0]?.[1] as
      | { id?: string; duration?: number; action?: { onClick?: () => void } }
      | undefined;
    expect(successOptions).toMatchObject({
      id: 'object:1',
      duration: 2_000,
    });
    expect(isValidElement(successOptions?.action)).toBe(true);
    expect(isValidElement(successOptions?.action) && successOptions.action.type).toBe(
      UndoToastButton,
    );
    if (isValidElement<{ onClick?: () => void }>(successOptions?.action)) {
      successOptions.action.props.onClick?.();
    }
    await vi.advanceTimersByTimeAsync(0);
    expect(undoRun).toHaveBeenCalledWith({ ok: true });
  });

  it('morphs a failed action to an error toast and returns the action error', async () => {
    const result = await notifyAction({
      id: 'object:1',
      loading: 'Updating status…',
      success: 'Status updated',
      error: 'Couldn’t update status',
      run: () => Promise.resolve({ error: 'stale' }),
    });

    expect(result).toEqual({ error: 'stale' });
    expect(toast.error).toHaveBeenCalledWith('Couldn’t update status', {
      id: 'object:1',
      duration: 6_000,
    });
  });

  it('toasts a bounded result error and keeps raw codes on the fallback', async () => {
    await notifyAction({
      id: 'object:1',
      loading: 'Updating items…',
      success: 'Items updated',
      error: 'Couldn’t update items',
      run: () => Promise.resolve({ error: '2 of 3 updates failed.' }),
    });
    expect(toast.error).toHaveBeenCalledWith('2 of 3 updates failed.', {
      id: 'object:1',
      duration: 6_000,
    });

    toast.error.mockReset();
    await notifyAction({
      id: 'object:2',
      loading: 'Updating status…',
      success: 'Status updated',
      error: 'Couldn’t update status',
      run: () => Promise.resolve({ error: 'Update failed' }),
    });
    expect(toast.error).toHaveBeenCalledWith('Couldn’t update status', {
      id: 'object:2',
      duration: 6_000,
    });
  });

  it('lets a newer action on the same id own the toast', async () => {
    let resolveFirst: (value: { ok: true }) => void = () => undefined;
    const first = notifyAction({
      id: 'object:1',
      loading: 'Updating status…',
      success: 'Status updated',
      error: 'Couldn’t update status',
      run: () =>
        new Promise<{ ok: true }>((resolve) => {
          resolveFirst = resolve;
        }),
    });
    const second = notifyAction({
      id: 'object:1',
      loading: 'Updating due date…',
      success: 'Due date updated',
      error: 'Couldn’t update due date',
      run: () => Promise.resolve({ ok: true }),
    });

    await second;
    expect(toast.success).toHaveBeenCalledWith('Due date updated', {
      id: 'object:1',
      duration: 2_000,
      action: undefined,
    });

    resolveFirst({ ok: true });
    await first;
    expect(toast.success).toHaveBeenCalledTimes(1);
  });
});

describe('notifyError', () => {
  beforeEach(() => {
    toast.error.mockReset();
    resetNotifyActionState();
  });

  it('shows a durable error toast', () => {
    notifyError('document:preview', 'Couldn’t open preview');
    expect(toast.error).toHaveBeenCalledWith('Couldn’t open preview', {
      id: 'document:preview',
      duration: 6_000,
    });
  });
});

describe('notifySuccess', () => {
  beforeEach(() => {
    toast.success.mockReset();
    resetNotifyActionState();
  });

  it('shows a completed-action success toast', () => {
    notifySuccess('integrations:oauth', 'MCP server connected');
    expect(toast.success).toHaveBeenCalledWith('MCP server connected', {
      id: 'integrations:oauth',
      duration: 2_000,
    });
  });
});
