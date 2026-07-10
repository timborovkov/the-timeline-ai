// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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
});

afterEach(() => {
  cleanup();
});

function renderChecklist(
  data: {
    dismissed: boolean;
    items: { key: string; label: string; completed: boolean }[];
  } | null,
  options: { checklistPending?: boolean; isPending?: boolean } = {},
) {
  const mutateChecklist = vi.fn();
  fakes.useOnboardingChecklistQuery.mockReturnValue({
    isPending: options.isPending ?? false,
    data,
    mutateChecklist,
    checklistPending: options.checklistPending ?? false,
  });

  render(<OnboardingChecklist />);
  return { mutateChecklist };
}

describe('OnboardingChecklist', () => {
  it('renders nothing while loading or without data', () => {
    renderChecklist(null, { isPending: true });
    expect(screen.queryByText('Setup checklist')).toBeNull();

    cleanup();
    renderChecklist(null);
    expect(screen.queryByText('Setup checklist')).toBeNull();
  });

  it('reopens dismissed checklists', () => {
    const { mutateChecklist } = renderChecklist({ dismissed: true, items: [] });

    fireEvent.click(screen.getByRole('button', { name: 'Reopen setup' }));

    expect(mutateChecklist).toHaveBeenCalledWith({ action: 'reopen' });
  });

  it('renders checklist progress, step links, and manual completion actions', () => {
    const { mutateChecklist } = renderChecklist({
      dismissed: false,
      items: [
        { key: 'first_note', label: 'Capture one timeline event', completed: true },
        { key: 'first_document', label: 'Upload a document', completed: false },
        { key: 'first_integration', label: 'Connect an integration', completed: false },
      ],
    });

    expect(screen.getByText('Setup checklist')).toBeTruthy();
    expect(screen.getByText('1/3 complete')).toBeTruthy();
    expect(screen.getByText('Capture one timeline event')).toBeTruthy();
    expect(screen.getByText('Upload a document')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Upload' }).getAttribute('href')).toBe(
      '/app/documents',
    );
    expect(screen.getByRole('link', { name: 'Connect' }).getAttribute('href')).toBe(
      '/app/team/integrations',
    );
    expect(screen.getAllByText('Done')).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'Mark Upload a document complete' }));

    expect(mutateChecklist).toHaveBeenCalledWith({ action: 'complete', key: 'first_document' });
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
});
