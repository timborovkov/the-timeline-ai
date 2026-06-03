import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

describe('OnboardingChecklist', () => {
  it('renders nothing while loading or without data', () => {
    fakes.useOnboardingChecklistQuery.mockReturnValue({ isPending: true });
    expect(renderToStaticMarkup(createElement(OnboardingChecklist))).toBe('');

    fakes.useOnboardingChecklistQuery.mockReturnValue({ isPending: false, data: null });
    expect(renderToStaticMarkup(createElement(OnboardingChecklist))).toBe('');
  });

  it('renders dismissed reopen state', () => {
    fakes.useOnboardingChecklistQuery.mockReturnValue({
      isPending: false,
      data: { dismissed: true, items: [] },
      mutateChecklist: vi.fn(),
      checklistPending: false,
    });

    expect(renderToStaticMarkup(createElement(OnboardingChecklist))).toContain('Reopen setup');
  });

  it('renders checklist progress and incomplete-step actions', () => {
    fakes.useOnboardingChecklistQuery.mockReturnValue({
      isPending: false,
      data: {
        dismissed: false,
        items: [
          { key: 'first_note', label: 'Capture one timeline event', completed: true },
          { key: 'first_document', label: 'Upload a document', completed: false },
        ],
      },
      mutateChecklist: vi.fn(),
      checklistPending: false,
    });

    const html = renderToStaticMarkup(createElement(OnboardingChecklist));

    expect(html).toContain('Setup checklist');
    expect(html).toContain('1/2 complete');
    expect(html).toContain('Capture one timeline event');
    expect(html).toContain('Upload a document');
    expect(html).toContain('Mark Upload a document complete');
  });
});
