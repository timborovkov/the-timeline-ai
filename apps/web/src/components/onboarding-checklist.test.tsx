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

  const view = render(<OnboardingChecklist />);
  return { mutateChecklist, retryChecklist, retryChecklistMutation, view };
}

describe('OnboardingChecklist', () => {
  it('renders a structure-matching busy state while loading and nothing without data', () => {
    renderChecklist(null, { isPending: true });
    expect(screen.getByLabelText('Loading team setup checklist').getAttribute('aria-busy')).toBe(
      'true',
    );

    cleanup();
    renderChecklist(null);
    expect(screen.queryByText('Team setup checklist')).toBeNull();
  });

  it('explains a loading failure and retries from the keyboard', async () => {
    const user = userEvent.setup();
    const { retryChecklist } = renderChecklist(null, { checklistLoadFailed: true });

    expect(screen.getByRole('alert').textContent).toBe(
      'Unable to load the team setup checklist. Check your connection and try again.',
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

    fireEvent.click(screen.getByRole('button', { name: 'Team setup checklist' }));

    expect(mutateChecklist).toHaveBeenCalledWith({ action: 'reopen' });
  });

  it('keeps the hidden checklist as a quiet toggle instead of a primary button', () => {
    renderChecklist({
      dismissed: true,
      items: [
        { key: 'telegram', label: 'Link Telegram', completed: true },
        { key: 'slack', label: 'Install Slack', completed: false },
      ],
    });

    const toggle = screen.getByRole('button', { name: 'Team setup checklist' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.className).toContain('text-fg-dim');
    expect(toggle.className).not.toMatch(/(?:^|\s)border(?:\s|$)/);
    expect(toggle.querySelector('svg')).toBeTruthy();
    expect(screen.getByText('1/2')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Team setup checklist' })).toBeNull();
  });

  it('restores focus to dismiss setup after reopening the checklist', () => {
    const { mutateChecklist, view } = renderChecklist({ dismissed: true, items: [] });

    const reopen = screen.getByRole('button', { name: 'Team setup checklist' });
    reopen.focus();
    fireEvent.click(reopen);
    expect(mutateChecklist).toHaveBeenCalledWith({ action: 'reopen' });

    fakes.useOnboardingChecklistQuery.mockReturnValue({
      isPending: false,
      checklistLoadFailed: false,
      checklistMutationFailed: false,
      data: { dismissed: false, items: [] },
      mutateChecklist,
      retryChecklist: vi.fn(),
      retryChecklistMutation: vi.fn(),
      checklistPending: false,
    });
    view.rerender(<OnboardingChecklist />);

    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Hide team setup checklist' }),
    );
  });

  it('announces and retries a failed reopen from the dismissed state', () => {
    const { retryChecklistMutation } = renderChecklist(
      { dismissed: true, items: [] },
      { checklistMutationFailed: true },
    );

    expect(screen.getByRole('alert').textContent).toBe(
      'Unable to update the team setup checklist. Your previous state was restored.',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Retry update' }));
    expect(retryChecklistMutation).toHaveBeenCalledOnce();
  });

  it('renders every step and keeps actions on the next incomplete step', () => {
    const { mutateChecklist } = renderChecklist({
      dismissed: false,
      items: [
        { key: 'first_note', label: 'Capture one timeline event', completed: true },
        { key: 'first_document', label: 'Upload a document', completed: false },
        { key: 'first_integration', label: 'Connect an integration', completed: false },
      ],
    });

    expect(screen.getByRole('heading', { name: 'Team setup checklist' }).className).toContain(
      'text-xs',
    );
    expect(screen.getByRole('heading', { name: 'Team setup checklist' }).className).not.toContain(
      'font-semibold',
    );
    expect(
      screen
        .getByRole('button', { name: 'Hide team setup checklist' })
        .getAttribute('aria-expanded'),
    ).toBe('true');
    expect(screen.getByText('1/3')).toBeTruthy();
    expect(screen.getByText('Capture one timeline event')).toBeTruthy();
    expect(screen.getByText('Upload a document')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Connect an integration' }).getAttribute('href')).toBe(
      '/app/sources',
    );
    expect(screen.getByRole('link', { name: 'Upload' }).getAttribute('href')).toBe(
      '/app/documents',
    );
    expect(screen.queryByRole('link', { name: 'Connect' })).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'Mark Capture one timeline event complete' }),
    ).toBeNull();

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

  it('moves focus to the surviving dismiss control after completing the final step', () => {
    const { mutateChecklist, view } = renderChecklist({
      dismissed: false,
      items: [{ key: 'telegram', label: 'Link Telegram', completed: false }],
    });

    const complete = screen.getByRole('button', { name: 'Mark Link Telegram complete' });
    complete.focus();
    fireEvent.click(complete);
    expect(mutateChecklist).toHaveBeenCalledWith({ action: 'complete', key: 'telegram' });

    fakes.useOnboardingChecklistQuery.mockReturnValue({
      isPending: false,
      checklistLoadFailed: false,
      checklistMutationFailed: false,
      data: {
        dismissed: false,
        items: [{ key: 'telegram', label: 'Link Telegram', completed: true }],
      },
      mutateChecklist,
      retryChecklist: vi.fn(),
      retryChecklistMutation: vi.fn(),
      checklistPending: true,
    });
    view.rerender(<OnboardingChecklist />);

    fakes.useOnboardingChecklistQuery.mockReturnValue({
      isPending: false,
      checklistLoadFailed: false,
      checklistMutationFailed: false,
      data: {
        dismissed: false,
        items: [{ key: 'telegram', label: 'Link Telegram', completed: true }],
      },
      mutateChecklist,
      retryChecklist: vi.fn(),
      retryChecklistMutation: vi.fn(),
      checklistPending: false,
    });
    view.rerender(<OnboardingChecklist />);

    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Hide team setup checklist' }),
    );
  });

  it('returns completion retry focus to retry after rollback and dismiss after success', () => {
    const item = { key: 'telegram', label: 'Link Telegram', completed: false };
    const { mutateChecklist, retryChecklistMutation, view } = renderChecklist({
      dismissed: false,
      items: [item],
    });
    fireEvent.click(screen.getByRole('button', { name: 'Mark Link Telegram complete' }));

    fakes.useOnboardingChecklistQuery.mockReturnValue({
      isPending: false,
      checklistLoadFailed: false,
      checklistMutationFailed: false,
      data: { dismissed: false, items: [{ ...item, completed: true }] },
      mutateChecklist,
      retryChecklist: vi.fn(),
      retryChecklistMutation,
      checklistPending: true,
    });
    view.rerender(<OnboardingChecklist />);
    fakes.useOnboardingChecklistQuery.mockReturnValue({
      isPending: false,
      checklistLoadFailed: false,
      checklistMutationFailed: true,
      data: { dismissed: false, items: [item] },
      mutateChecklist,
      retryChecklist: vi.fn(),
      retryChecklistMutation,
      checklistPending: false,
    });
    view.rerender(<OnboardingChecklist />);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Retry update' }));

    fireEvent.click(screen.getByRole('button', { name: 'Retry update' }));
    expect(retryChecklistMutation).toHaveBeenCalledOnce();
    fakes.useOnboardingChecklistQuery.mockReturnValue({
      isPending: false,
      checklistLoadFailed: false,
      checklistMutationFailed: false,
      data: { dismissed: false, items: [{ ...item, completed: true }] },
      mutateChecklist,
      retryChecklist: vi.fn(),
      retryChecklistMutation,
      checklistPending: true,
    });
    view.rerender(<OnboardingChecklist />);
    fakes.useOnboardingChecklistQuery.mockReturnValue({
      isPending: false,
      checklistLoadFailed: false,
      checklistMutationFailed: false,
      data: { dismissed: false, items: [{ ...item, completed: true }] },
      mutateChecklist,
      retryChecklist: vi.fn(),
      retryChecklistMutation,
      checklistPending: false,
    });
    view.rerender(<OnboardingChecklist />);

    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Hide team setup checklist' }),
    );
  });

  it('announces progress and an in-flight setup update', () => {
    renderChecklist(
      {
        dismissed: false,
        items: [{ key: 'telegram', label: 'Link Telegram', completed: false }],
      },
      { checklistPending: true },
    );

    expect(screen.getByText('0/1').getAttribute('aria-label')).toBe(
      '0 of 1 checklist steps complete',
    );
    expect(screen.getByText('Updating checklist…').getAttribute('aria-live')).toBe('polite');
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
      name: 'Hide team setup checklist',
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

    fireEvent.click(screen.getByRole('button', { name: 'Hide team setup checklist' }));
    expect(active.mutateChecklist).toHaveBeenCalledWith({ action: 'dismiss' });
  });

  it('restores focus to reopen setup after dismissing the checklist', () => {
    const { mutateChecklist, view } = renderChecklist({
      dismissed: false,
      items: [{ key: 'telegram', label: 'Link Telegram', completed: false }],
    });

    const dismiss = screen.getByRole<HTMLButtonElement>('button', {
      name: 'Hide team setup checklist',
    });
    dismiss.focus();
    fireEvent.click(dismiss);
    expect(mutateChecklist).toHaveBeenCalledWith({ action: 'dismiss' });

    fakes.useOnboardingChecklistQuery.mockReturnValue({
      isPending: false,
      checklistLoadFailed: false,
      checklistMutationFailed: false,
      data: { dismissed: true, items: [] },
      mutateChecklist,
      retryChecklist: vi.fn(),
      retryChecklistMutation: vi.fn(),
      checklistPending: false,
    });
    view.rerender(<OnboardingChecklist />);

    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Team setup checklist' }),
    );
  });

  it('restores focus to dismiss setup when a dismissal is rolled back', () => {
    const { mutateChecklist, view } = renderChecklist({
      dismissed: false,
      items: [{ key: 'telegram', label: 'Link Telegram', completed: false }],
    });

    const dismiss = screen.getByRole('button', { name: 'Hide team setup checklist' });
    dismiss.focus();
    fireEvent.click(dismiss);
    expect(mutateChecklist).toHaveBeenCalledWith({ action: 'dismiss' });

    fakes.useOnboardingChecklistQuery.mockReturnValue({
      isPending: false,
      checklistLoadFailed: false,
      checklistMutationFailed: false,
      data: { dismissed: true, items: [] },
      mutateChecklist,
      retryChecklist: vi.fn(),
      retryChecklistMutation: vi.fn(),
      checklistPending: true,
    });
    view.rerender(<OnboardingChecklist />);

    fakes.useOnboardingChecklistQuery.mockReturnValue({
      isPending: false,
      checklistLoadFailed: false,
      checklistMutationFailed: true,
      data: {
        dismissed: false,
        items: [{ key: 'telegram', label: 'Link Telegram', completed: false }],
      },
      mutateChecklist,
      retryChecklist: vi.fn(),
      retryChecklistMutation: vi.fn(),
      checklistPending: false,
    });
    view.rerender(<OnboardingChecklist />);

    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Hide team setup checklist' }),
    );
  });

  it('restores focus to reopen setup when a reopening is rolled back', () => {
    const { mutateChecklist, view } = renderChecklist({ dismissed: true, items: [] });

    const reopen = screen.getByRole('button', { name: 'Team setup checklist' });
    reopen.focus();
    fireEvent.click(reopen);
    expect(mutateChecklist).toHaveBeenCalledWith({ action: 'reopen' });

    fakes.useOnboardingChecklistQuery.mockReturnValue({
      isPending: false,
      checklistLoadFailed: false,
      checklistMutationFailed: false,
      data: { dismissed: false, items: [] },
      mutateChecklist,
      retryChecklist: vi.fn(),
      retryChecklistMutation: vi.fn(),
      checklistPending: true,
    });
    view.rerender(<OnboardingChecklist />);

    fakes.useOnboardingChecklistQuery.mockReturnValue({
      isPending: false,
      checklistLoadFailed: false,
      checklistMutationFailed: true,
      data: { dismissed: true, items: [] },
      mutateChecklist,
      retryChecklist: vi.fn(),
      retryChecklistMutation: vi.fn(),
      checklistPending: false,
    });
    view.rerender(<OnboardingChecklist />);

    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Team setup checklist' }),
    );
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
      'Unable to update the team setup checklist. Your previous state was restored.',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Retry update' }));
    expect(retryChecklistMutation).toHaveBeenCalledOnce();
  });

  it('restores focus to reopen setup after a retried dismissal succeeds', () => {
    const { retryChecklistMutation, view } = renderChecklist(
      {
        dismissed: false,
        items: [{ key: 'telegram', label: 'Link Telegram', completed: false }],
      },
      { checklistMutationFailed: true },
    );

    fireEvent.click(screen.getByRole('button', { name: 'Retry update' }));
    expect(retryChecklistMutation).toHaveBeenCalledOnce();

    fakes.useOnboardingChecklistQuery.mockReturnValue({
      isPending: false,
      checklistLoadFailed: false,
      checklistMutationFailed: false,
      data: { dismissed: true, items: [] },
      mutateChecklist: vi.fn(),
      retryChecklist: vi.fn(),
      retryChecklistMutation,
      checklistPending: true,
    });
    view.rerender(<OnboardingChecklist />);

    fakes.useOnboardingChecklistQuery.mockReturnValue({
      isPending: false,
      checklistLoadFailed: false,
      checklistMutationFailed: false,
      data: { dismissed: true, items: [] },
      mutateChecklist: vi.fn(),
      retryChecklist: vi.fn(),
      retryChecklistMutation,
      checklistPending: false,
    });
    view.rerender(<OnboardingChecklist />);

    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Team setup checklist' }),
    );
  });

  it('restores focus after a retried reopening is rolled back', () => {
    const { retryChecklistMutation, view } = renderChecklist(
      { dismissed: true, items: [] },
      { checklistMutationFailed: true },
    );

    fireEvent.click(screen.getByRole('button', { name: 'Retry update' }));
    expect(retryChecklistMutation).toHaveBeenCalledOnce();

    fakes.useOnboardingChecklistQuery.mockReturnValue({
      isPending: false,
      checklistLoadFailed: false,
      checklistMutationFailed: false,
      data: { dismissed: false, items: [] },
      mutateChecklist: vi.fn(),
      retryChecklist: vi.fn(),
      retryChecklistMutation,
      checklistPending: true,
    });
    view.rerender(<OnboardingChecklist />);

    fakes.useOnboardingChecklistQuery.mockReturnValue({
      isPending: false,
      checklistLoadFailed: false,
      checklistMutationFailed: true,
      data: { dismissed: true, items: [] },
      mutateChecklist: vi.fn(),
      retryChecklist: vi.fn(),
      retryChecklistMutation,
      checklistPending: false,
    });
    view.rerender(<OnboardingChecklist />);

    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Team setup checklist' }),
    );
  });
});
