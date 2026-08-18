// @vitest-environment happy-dom

import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent, { PointerEventsCheckLevel } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fakes = vi.hoisted(() => ({
  refresh: vi.fn(),
  reviseSuggestionItemAction: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: fakes.refresh }) }));
vi.mock('sonner', () => ({
  toast: {
    success: fakes.toastSuccess,
    loading: vi.fn(() => 'toast-1'),
    error: vi.fn(),
  },
}));
vi.mock('@/app/actions/suggestions', () => ({
  reviseSuggestionItemAction: fakes.reviseSuggestionItemAction,
}));

const { SuggestionChangeDialog } = await import('./suggestion-change-dialog.js');

beforeEach(() => {
  vi.clearAllMocks();
  fakes.reviseSuggestionItemAction.mockResolvedValue({ ok: true });
});

afterEach(cleanup);

describe('SuggestionChangeDialog', () => {
  it('sends reviewer feedback and leaves the revised proposal pending', async () => {
    const user = userEvent.setup({ pointerEventsCheck: PointerEventsCheckLevel.Never });
    const onRevised = vi.fn();
    fakes.reviseSuggestionItemAction.mockResolvedValue({
      ok: true,
      revisedItem: {
        id: '11111111-1111-4111-8111-111111111111',
        status: 'pending',
        title: 'Miku to register with PRH',
        description: 'Miku made the promise.',
        proposedPayload: { ownerName: 'Miku' },
      },
    });
    render(
      <SuggestionChangeDialog
        itemId="11111111-1111-4111-8111-111111111111"
        title="PRH company registration"
        onRevised={onRevised}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Change' }));
    const dialog = screen.getByRole('dialog', { name: 'Change “PRH company registration”' });
    expect(
      within(dialog).getByText(/nothing will be applied yet and its source evidence will stay/i),
    ).toBeTruthy();
    await user.type(
      within(dialog).getByLabelText('What should change?'),
      'Miku made this promise, not Tim.',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Update proposal' }));

    await waitFor(() => {
      expect(fakes.reviseSuggestionItemAction).toHaveBeenCalledWith({
        itemId: '11111111-1111-4111-8111-111111111111',
        feedback: 'Miku made this promise, not Tim.',
      });
    });
    expect(onRevised).toHaveBeenCalledWith({
      id: '11111111-1111-4111-8111-111111111111',
      status: 'pending',
      title: 'Miku to register with PRH',
      description: 'Miku made the promise.',
      proposedPayload: { ownerName: 'Miku' },
    });
    expect(fakes.toastSuccess).toHaveBeenCalledWith('Proposal updated', { id: 'toast-1' });
    expect(fakes.refresh).toHaveBeenCalled();
  });

  it('keeps the dialog open and shows an action error', async () => {
    const user = userEvent.setup({ pointerEventsCheck: PointerEventsCheckLevel.Never });
    fakes.reviseSuggestionItemAction.mockResolvedValue({ error: 'Proposal is no longer editable' });
    render(
      <SuggestionChangeDialog
        itemId="11111111-1111-4111-8111-111111111111"
        title="PRH company registration"
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Change' }));
    const dialog = screen.getByRole('dialog', { name: 'Change “PRH company registration”' });
    await user.type(within(dialog).getByLabelText('What should change?'), 'Use Miku.');
    await user.click(within(dialog).getByRole('button', { name: 'Update proposal' }));

    expect((await within(dialog).findByRole('alert')).textContent).toBe(
      'Proposal is no longer editable',
    );
    expect(fakes.refresh).not.toHaveBeenCalled();
  });
});
