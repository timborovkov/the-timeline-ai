// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fakes = vi.hoisted(() => ({
  useOnboardingChecklistQuery: vi.fn(),
}));

vi.mock('@/lib/use-paginated-queries', () => ({
  useOnboardingChecklistQuery: fakes.useOnboardingChecklistQuery,
}));

const { OnboardingChecklist } = await import('./onboarding-checklist.js');

beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState({}, '', '/app');
});

afterEach(() => {
  cleanup();
});

function renderChecklist(
  data: {
    dismissed: boolean;
    items: { key: string; label: string; completed: boolean }[];
  } | null,
  options: {
    checklistPending?: boolean;
    isPending?: boolean;
    checklistLoadFailed?: boolean;
    checklistMutationFailed?: boolean;
  } = {},
) {
  const mutateChecklist = vi.fn();
  const retryChecklist = vi.fn();
  const retryChecklistMutation = vi.fn();
  fakes.useOnboardingChecklistQuery.mockReturnValue({
    isPending: options.isPending ?? false,
    checklistLoadFailed: options.checklistLoadFailed ?? false,
    checklistMutationFailed: options.checklistMutationFailed ?? false,
    data,
    mutateChecklist,
    retryChecklist,
    retryChecklistMutation,
    checklistPending: options.checklistPending ?? false,
  });

  render(<OnboardingChecklist />);
  return { mutateChecklist, retryChecklist, retryChecklistMutation };
}

describe('OnboardingChecklist', () => {
  it('renders a structure-matching busy state while loading and nothing without data', () => {
    renderChecklist(null, { isPending: true });
    expect(screen.getByLabelText('Loading next setup step').getAttribute('aria-busy')).toBe('true');

    cleanup();
    renderChecklist(null);
    expect(screen.queryByText('Next setup step')).toBeNull();
  });

  it('explains a loading failure and retries from the keyboard', async () => {
    const user = userEvent.setup();
    const { retryChecklist } = renderChecklist(null, { checklistLoadFailed: true });

    expect(screen.getByRole('alert').textContent).toBe(
      'Unable to load setup. Check your connection and try again.',
    );
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Retry' }));
    await user.keyboard('{Enter}');
    expect(retryChecklist).toHaveBeenCalledOnce();
  });

  it('keeps a stale setup step available when the next load fails', () => {
    renderChecklist(
      {
        dismissed: false,
        items: [{ key: 'telegram', label: 'Link Telegram', completed: false }],
      },
      { checklistLoadFailed: true },
    );

    expect(screen.getByText('Link Telegram')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('reopens dismissed checklists', () => {
    const { mutateChecklist } = renderChecklist({ dismissed: true, items: [] });

    fireEvent.click(screen.getByRole('button', { name: 'Reopen setup' }));

    expect(mutateChecklist).toHaveBeenCalledWith({ action: 'reopen' });
  });

  it('announces and retries a failed reopen from the dismissed state', () => {
    const { retryChecklistMutation } = renderChecklist(
      { dismissed: true, items: [] },
      { checklistMutationFailed: true },
    );

    expect(screen.getByRole('alert').textContent).toBe(
      'Unable to update setup. Your previous setup state was restored.',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Retry update' }));
    expect(retryChecklistMutation).toHaveBeenCalledOnce();
  });

  it('renders progress and only the next incomplete step', () => {
    const { mutateChecklist } = renderChecklist({
      dismissed: false,
      items: [
        { key: 'first_note', label: 'Capture one timeline event', completed: true },
        { key: 'first_document', label: 'Upload a document', completed: false },
        { key: 'first_integration', label: 'Connect an integration', completed: false },
      ],
    });

    expect(screen.getByText('Next setup step')).toBeTruthy();
    expect(screen.getByText('1/3')).toBeTruthy();
    expect(screen.getByText('Upload a document')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Upload' }).getAttribute('href')).toBe(
      '/app/documents',
    );
    expect(screen.queryByText('Connect an integration')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Mark Upload a document complete' }));

    expect(mutateChecklist).toHaveBeenCalledWith({ action: 'complete', key: 'first_document' });
  });

  it('opens the capture dialog hash directly for the first note step', () => {
    renderChecklist({
      dismissed: false,
      items: [{ key: 'first_note', label: 'Capture one timeline event', completed: false }],
    });

    fireEvent.click(screen.getByRole('button', { name: 'Capture' }));

    expect(window.location.hash).toBe('#capture');
  });

  it('dismisses the checklist and disables mutation controls while pending', () => {
    const { mutateChecklist } = renderChecklist(
      {
        dismissed: false,
        items: [{ key: 'telegram', label: 'Link Telegram', completed: false }],
      },
      { checklistPending: true },
    );

    const dismiss = screen.getByRole<HTMLButtonElement>('button', {
      name: 'Dismiss setup checklist',
    });
    const complete = screen.getByRole<HTMLButtonElement>('button', {
      name: 'Mark Link Telegram complete',
    });

    expect(dismiss.disabled).toBe(true);
    expect(complete.disabled).toBe(true);
    fireEvent.click(dismiss);
    expect(mutateChecklist).not.toHaveBeenCalled();

    cleanup();
    const active = renderChecklist({
      dismissed: false,
      items: [{ key: 'telegram', label: 'Link Telegram', completed: false }],
    });

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss setup checklist' }));
    expect(active.mutateChecklist).toHaveBeenCalledWith({ action: 'dismiss' });
  });

  it('announces an update failure and retries the restored action', () => {
    const { retryChecklistMutation } = renderChecklist(
      {
        dismissed: false,
        items: [{ key: 'telegram', label: 'Link Telegram', completed: false }],
      },
      { checklistMutationFailed: true },
    );

    expect(screen.getByRole('alert').textContent).toBe(
      'Unable to update setup. Your previous setup state was restored.',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Retry update' }));
    expect(retryChecklistMutation).toHaveBeenCalledOnce();
  });
});
