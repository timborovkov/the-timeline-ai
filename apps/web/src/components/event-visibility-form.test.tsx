// @vitest-environment happy-dom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

const fakes = vi.hoisted(() => ({
  setVisibility: vi.fn(),
}));

vi.mock('@/app/actions/visibility', () => ({
  setEventVisibilityAction: fakes.setVisibility,
}));

const { EventVisibilityForm } = await import('./event-visibility-form.js');

afterEach(() => {
  cleanup();
  fakes.setVisibility.mockReset();
});

describe('EventVisibilityForm', () => {
  it('labels visibility and specific-person selection, then announces and reports a save', async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    fakes.setVisibility.mockResolvedValue({ ok: true });

    render(
      <EventVisibilityForm
        eventId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
        visibility="team"
        visibilityUserIds={null}
        members={[
          { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', label: 'Alex' },
          { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', label: 'Sam' },
        ]}
        onSaved={onSaved}
      />,
    );

    await user.selectOptions(screen.getByLabelText('Who can see this evidence?'), 'specific_users');
    const memberGroup = screen.getByRole('group', { name: 'People with access' });
    await user.click(withinMember(memberGroup, 'Alex'));
    await user.click(screen.getByRole('button', { name: 'Save visibility' }));

    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toBe('Visibility saved');
      expect(onSaved).toHaveBeenCalledWith({
        visibility: 'specific_users',
        visibilityUserIds: ['bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'],
      });
    });
  });

  it('announces a retryable save error', async () => {
    const user = userEvent.setup();
    fakes.setVisibility.mockResolvedValue({ error: 'Could not save visibility' });
    render(
      <EventVisibilityForm
        eventId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
        visibility="private"
        visibilityUserIds={null}
        members={[]}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Save visibility' }));

    expect((await screen.findByRole('alert')).textContent).toBe('Could not save visibility');
  });
});

function withinMember(group: HTMLElement, label: string): HTMLElement {
  const input = group.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
  if (input) return input;
  const labels = [...group.querySelectorAll('label')];
  const matching = labels.find((item) => item.textContent.trim() === label);
  const checkbox = matching?.querySelector<HTMLInputElement>('input[type="checkbox"]');
  if (!checkbox) throw new Error(`Could not find member checkbox for ${label}`);
  return checkbox;
}
