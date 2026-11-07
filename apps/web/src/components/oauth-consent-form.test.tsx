import { expect, vi } from '@timeline/test-support';
import { afterEach, describe, it } from 'bun:test';

// Test environment: happy-dom
const approve = vi.fn((_data: FormData): Promise<{ error: string } | undefined> =>
  Promise.resolve(undefined),
);
await vi.mock(
  import.meta.resolve('@/app/oauth/actions'),
  () => ({ approveMcpOAuthAction: approve }),
  () => import('@/app/oauth/actions'),
);
const { cleanup, render, screen, fireEvent, waitFor } = await import('@testing-library/react');
const { OAuthConsentForm } = await import('@/components/oauth-consent-form');
import type { ConsentMembership } from '@/components/oauth-consent-form';
const defaults = { mode: 'handoffs' as const, scope: 'Workspace project', revision: '1' };
const owner: ConsentMembership = {
  teamId: 'owner-team',
  teamName: 'Owner team',
  teamSlug: 'owner',
  role: 'owner',
  reporting: { defaults, override: null },
};
const member: ConsentMembership = {
  ...owner,
  teamId: 'member-team',
  teamName: 'Member team',
  role: 'member',
  reporting: { defaults: { ...defaults, scope: 'Member project' }, override: null },
};
function mount(memberships = [owner, member]) {
  render(
    <OAuthConsentForm
      memberships={memberships}
      defaultTeamId={memberships[0]?.teamId ?? null}
      requiresTeamAdmin={false}
    >
      <input name="state" value="original-state" readOnly />
    </OAuthConsentForm>,
  );
}
const command = () =>
  document.querySelector<HTMLInputElement>('input[name="reporting_mode"]')?.value;
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
describe('consent reporting agreement', () => {
  it('inherits visibly, allows read-only inheritance, and discards drafts when switching teams', () => {
    mount();
    expect(screen.getByLabelText<HTMLSelectElement>('Reporting agreement').value).toBe('inherit');
    expect(screen.getByText(/Effective agreement:.*Workspace project/)).toBeTruthy();
    expect(command()).toBe('preserve');
    fireEvent.click(screen.getByRole('checkbox'));
    expect(screen.getByText(/Reporting is inactive/)).toBeTruthy();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Allow access' }).disabled).toBe(
      false,
    );
    fireEvent.change(screen.getByLabelText('Reporting agreement'), {
      target: { value: 'handoffs' },
    });
    fireEvent.change(screen.getByLabelText('Project or work scope'), {
      target: { value: 'Unsaved scope' },
    });
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Allow access' }).disabled).toBe(
      true,
    );
    fireEvent.click(screen.getByRole('radio', { name: /Member team/ }));
    expect(screen.queryByLabelText('Reporting agreement')).toBeNull();
    expect(screen.getByText(/Effective agreement:.*Member project/)).toBeTruthy();
    expect(command()).toBeUndefined();
    fireEvent.click(screen.getByRole('radio', { name: /Owner team/ }));
    expect(screen.getByLabelText<HTMLSelectElement>('Reporting agreement').value).toBe('inherit');
    expect(screen.getByRole<HTMLInputElement>('checkbox').checked).toBe(false);
    expect(screen.queryByDisplayValue('Unsaved scope')).toBeNull();
  });
  it('preserves an existing override without edits, including read-only reauthorization', () => {
    mount([
      {
        ...owner,
        reporting: {
          defaults,
          override: { mode: 'handoffs', scope: 'Existing project', revision: 'saved' },
        },
      },
    ]);
    expect(screen.getByDisplayValue('Existing project')).toBeTruthy();
    fireEvent.click(screen.getByRole('checkbox'));
    expect(command()).toBe('preserve');
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Allow access' }).disabled).toBe(
      false,
    );
  });
  it('retains typed reporting choices after server validation fails', async () => {
    approve.mockResolvedValueOnce({
      error: 'Your role changed. Ask an owner to configure reporting.',
    });
    mount();
    fireEvent.change(screen.getByLabelText('Reporting agreement'), {
      target: { value: 'handoffs' },
    });
    fireEvent.change(screen.getByLabelText('Project or work scope'), {
      target: { value: 'Project handoff' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Allow access' }));
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('Your role changed');
    });
    expect(screen.getByLabelText<HTMLInputElement>('Project or work scope').value).toBe(
      'Project handoff',
    );
    expect(screen.getByRole<HTMLInputElement>('radio', { name: /Owner team/ }).checked).toBe(true);
    expect(screen.getByRole<HTMLInputElement>('checkbox').checked).toBe(true);
  });
});
