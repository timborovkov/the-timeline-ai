import { expect } from '@timeline/test-support';
import { vi } from '@timeline/test-support';
import { afterEach, beforeEach, describe, it } from 'bun:test';
// Test environment: happy-dom

const fakes = vi.hoisted(() => ({
  refresh: vi.fn(),
  reviseSuggestionItemAction: vi.fn(),
  notifyAction: vi.fn(),
}));

await vi.mock(
  import.meta.resolve('next/navigation'),
  async () => ({
    ...(await import('next/navigation')),
    useRouter: () => ({ refresh: fakes.refresh }),
  }),
  () => import('next/navigation'),
);
await vi.mock(
  import.meta.resolve('@/lib/notify'),
  async () => ({
    ...(await import('@/lib/notify')),
    notifyAction: async (options: { run: () => Promise<{ error?: string }> }) => {
      fakes.notifyAction(options);
      return options.run();
    },
  }),
  () => import('@/lib/notify'),
);
await vi.mock(
  import.meta.resolve('@/app/actions/suggestions'),
  () => ({
    reviseSuggestionItemAction: fakes.reviseSuggestionItemAction,
  }),
  () => import('@/app/actions/suggestions'),
);

const { cleanup, render, screen, waitFor, within } = await import('@testing-library/react');
const { default: userEvent, PointerEventsCheckLevel } = await import('@testing-library/user-event');

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
    expect(fakes.notifyAction).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'approval:11111111-1111-4111-8111-111111111111:change',
        loading: 'Updating proposal…',
        success: 'Proposal updated',
        error: 'Couldn’t update proposal',
      }),
    );
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
    expect(fakes.notifyAction).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'approval:11111111-1111-4111-8111-111111111111:change',
        error: 'Couldn’t update proposal',
      }),
    );
    expect(fakes.refresh).not.toHaveBeenCalled();
  });
});
