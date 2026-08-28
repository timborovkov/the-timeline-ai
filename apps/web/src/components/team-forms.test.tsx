// @vitest-environment happy-dom

import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as ReactModule from 'react';
import type * as ReactDomModule from 'react-dom';

const fakes = vi.hoisted(() => ({
  action: vi.fn(),
  useActionState: vi.fn(),
  useFormStatus: vi.fn(),
}));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactModule>();
  return {
    ...actual,
    useActionState: fakes.useActionState,
  };
});

vi.mock('react-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactDomModule>();
  return {
    ...actual,
    useFormStatus: fakes.useFormStatus,
  };
});

vi.mock('@/app/actions/team-exports', () => ({
  createTeamExportAction: vi.fn(),
  downloadTeamExportAction: vi.fn(),
}));

vi.mock('@/app/actions/teams', () => ({
  createTeamAction: vi.fn(),
  inviteMemberAction: vi.fn(),
  renameTeamAction: vi.fn(),
  updateDigestPreferenceAction: vi.fn(),
  addDigestDestinationAction: vi.fn(),
  removeDigestDestinationAction: vi.fn(),
  updateInboundEmailWhitelistAction: vi.fn(),
  updateTeamTimezoneAction: vi.fn(),
}));
vi.mock('@/components/form-action-toast', () => ({
  FormActionToast: () => null,
}));
const notify = vi.hoisted(() => ({
  notifyError: vi.fn(),
}));
vi.mock('@/lib/notify', () => ({
  notifyError: notify.notifyError,
}));

const {
  DigestPreferenceForm,
  InboundEmailWhitelistForm,
  InviteMemberForm,
  TeamExportPanel,
  TeamTimezoneForm,
} = await import('./team-forms.js');

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  fakes.useActionState.mockReturnValue([{}, fakes.action]);
  fakes.useFormStatus.mockReturnValue({ pending: false });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('InboundEmailWhitelistForm', () => {
  it('renders configured inbound address and sender whitelist state', () => {
    render(
      <InboundEmailWhitelistForm
        inboundEmail="acme@inbound.timeline.dev"
        enabled
        senders={['ada@example.com', 'vendor@example.net']}
      />,
    );

    expect(screen.getByLabelText<HTMLInputElement>('Team email address').value).toBe(
      'acme@inbound.timeline.dev',
    );
    expect(screen.getByRole('button', { name: 'Copy team email' })).toBeTruthy();
    expect(
      screen.getByRole<HTMLInputElement>('checkbox', { name: 'Enable sender whitelist' }).checked,
    ).toBe(true);
    expect(screen.getByLabelText<HTMLTextAreaElement>('Allowed senders').value).toBe(
      'ada@example.com, vendor@example.net',
    );
  });

  it('shows unconfigured, success, error, and pending states clearly', () => {
    fakes.useActionState.mockReturnValue([{ ok: true }, fakes.action]);
    fakes.useFormStatus.mockReturnValue({ pending: true });

    render(<InboundEmailWhitelistForm inboundEmail={null} enabled={false} senders={[]} />);

    expect(screen.getByLabelText<HTMLInputElement>('Team email address').value).toBe(
      'Not configured',
    );
    const submit = screen.getByRole<HTMLButtonElement>('button', { name: 'Working…' });
    expect(submit.disabled).toBe(true);
    const enabledCheckbox = screen.getByRole('checkbox', { name: 'Enable sender whitelist' });
    expect(enabledCheckbox.closest('label')?.className).toContain('min-h-9');
    expect(enabledCheckbox.className).toContain('hover:border-border-strong');

    cleanup();
    fakes.useActionState.mockReturnValue([
      { error: 'Only admins can change inbound email settings.' },
      fakes.action,
    ]);
    fakes.useFormStatus.mockReturnValue({ pending: false });
    render(<InboundEmailWhitelistForm inboundEmail={null} enabled={false} senders={[]} />);

    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('TeamTimezoneForm', () => {
  it('keeps timezone field validation inline and leaves server failures to the action toast', () => {
    fakes.useActionState.mockReturnValue([{ ok: true }, fakes.action]);
    fakes.useFormStatus.mockReturnValue({ pending: true });
    const view = render(<TeamTimezoneForm timezone="America/New_York" />);

    expect(screen.queryByRole('button', { name: 'Save timezone' })).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();

    fakes.useActionState.mockReturnValue([
      { error: 'Only admins can update the timezone.' },
      fakes.action,
    ]);
    fakes.useFormStatus.mockReturnValue({ pending: false });
    view.rerender(<TeamTimezoneForm timezone="America/New_York" />);

    const timezone = screen.getByLabelText('Team timezone');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(timezone.className).toContain('focus-visible:ring-2');
    expect(timezone.className).toContain('h-9');
    expect(timezone.className).toContain('rounded-sm');
    expect(timezone.className).toContain('hover:border-border-strong');
    expect(timezone.getAttribute('aria-invalid')).toBeNull();

    fakes.useActionState.mockReturnValue([{ error: 'Choose a valid timezone' }, fakes.action]);
    view.rerender(<TeamTimezoneForm timezone="America/New_York" />);

    expect(screen.getByLabelText('Team timezone').getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByLabelText('Team timezone').getAttribute('aria-describedby')).toBe(
      'team-timezone-error',
    );
    expect(screen.getByRole('alert').id).toBe('team-timezone-error');

    fakes.useFormStatus.mockReturnValue({ pending: true });
    view.rerender(<TeamTimezoneForm timezone="America/New_York" />);

    expect(screen.getByLabelText('Team timezone').getAttribute('aria-invalid')).toBeNull();
    expect(screen.getByLabelText('Team timezone').getAttribute('aria-describedby')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();

    fakes.useActionState.mockReturnValue([{ ok: true }, fakes.action]);
    fakes.useFormStatus.mockReturnValue({ pending: false });
    view.rerender(<TeamTimezoneForm timezone="America/New_York" />);

    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('DigestPreferenceForm', () => {
  it('gives the digest checkbox a 36px labelled target with a visible focus ring', () => {
    render(<DigestPreferenceForm enabled />);

    const checkbox = screen.getByRole('checkbox', { name: /Send me a personal daily digest/ });
    expect(checkbox.className).toContain('focus-visible:ring-2');
    expect(checkbox.className).toContain('hover:border-border-strong');
    expect(checkbox.closest('label')?.className).toContain('min-h-9');
  });
});

describe('Team form field hover treatment', () => {
  it('keeps text inputs and the sender field in the explicit hover contract', () => {
    render(
      <>
        <InboundEmailWhitelistForm inboundEmail={null} enabled={false} senders={[]} />
        <InviteMemberForm canInviteAdmin={false} />
      </>,
    );

    expect(screen.getByLabelText('Allowed senders').className).toContain(
      'hover:border-border-strong',
    );
    expect(screen.getByLabelText('Email').className).toContain('hover:border-border-strong');
  });
});

describe('InviteMemberForm', () => {
  it('limits admin invites when the current member cannot invite admins', () => {
    render(<InviteMemberForm canInviteAdmin={false} />);

    const role = screen.getByLabelText<HTMLSelectElement>('Role');
    expect([...role.options].map((option) => option.value)).toEqual(['member']);
    expect(role.className).toContain('hover:border-border-strong');
    expect(screen.getByRole('button', { name: 'Create invite' })).toBeTruthy();
  });

  it('shows generated links, sent state, and failed email delivery without hiding the link', () => {
    fakes.useActionState.mockReturnValue([
      {
        inviteUrl: 'https://timeline.test/invite/token-1',
        sendStatus: 'sent',
      },
      fakes.action,
    ]);
    render(<InviteMemberForm canInviteAdmin />);

    expect(
      [...screen.getByLabelText<HTMLSelectElement>('Role').options].map((o) => o.value),
    ).toEqual(['member', 'admin']);
    expect(screen.getByText('Invite link (copy and share):')).toBeTruthy();
    expect(screen.getByText('https://timeline.test/invite/token-1')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe(
      'Invite created and email sent. The invite link is ready to share.',
    );

    cleanup();
    fakes.useActionState.mockReturnValue([
      {
        inviteUrl: 'https://timeline.test/invite/token-2',
        sendStatus: 'failed',
        sendError: 'Postmark rejected the recipient',
      },
      fakes.action,
    ]);
    render(<InviteMemberForm canInviteAdmin />);

    expect(screen.getByText('https://timeline.test/invite/token-2')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toBe(
      'Invite created, but the email was not sent: Postmark rejected the recipient. The link is ready to share.',
    );
  });

  it('keeps permission errors at the form level and connects email validation to its field', () => {
    fakes.useActionState.mockReturnValue([
      { error: 'Only admins can invite members.' },
      fakes.action,
    ]);

    render(<InviteMemberForm canInviteAdmin={false} />);

    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByLabelText('Email').getAttribute('aria-invalid')).toBeNull();
    expect(screen.getByLabelText('Role').getAttribute('aria-invalid')).toBeNull();

    cleanup();
    fakes.useActionState.mockReturnValue([{ error: 'Invalid email' }, fakes.action]);
    render(<InviteMemberForm canInviteAdmin={false} />);

    expect(screen.getByLabelText('Email').getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByLabelText('Email').getAttribute('aria-describedby')).toBe('invite-error');
    expect(screen.getByLabelText('Role').getAttribute('aria-describedby')).toBeNull();
  });

  it('uses a specific pending label and lets the invite action reflow to the full mobile width', () => {
    fakes.useFormStatus.mockReturnValue({ pending: true });

    render(<InviteMemberForm canInviteAdmin />);

    const submit = screen.getByRole<HTMLButtonElement>('button', { name: 'Creating invite…' });
    expect(submit.disabled).toBe(true);
    expect(submit.className).toContain('h-8');
  });
});

describe('TeamExportPanel', () => {
  it('renders the empty state with a start action', () => {
    render(<TeamExportPanel exports={[]} />);

    expect(
      screen.getByText('Builds a 24-hour archive of team data you are already allowed to see.'),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Start export' })).toBeTruthy();
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('shows action success, errors, and pending state', () => {
    fakes.useActionState.mockReturnValue([{ ok: true }, fakes.action]);
    fakes.useFormStatus.mockReturnValue({ pending: true });

    const view = render(<TeamExportPanel exports={[]} />);

    const submit = screen.getByRole<HTMLButtonElement>('button', { name: 'Working…' });
    expect(submit.disabled).toBe(true);
    expect(screen.queryByRole('status')).toBeNull();

    fakes.useActionState.mockReturnValue([
      { error: 'Only owners and admins can export team data' },
      fakes.action,
    ]);
    fakes.useFormStatus.mockReturnValue({ pending: false });
    view.rerender(<TeamExportPanel exports={[]} />);

    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it.each([
    ['invalid', 'That export link is invalid. Refresh and try again.'],
    ['forbidden', 'You no longer have permission to download team exports.'],
    [
      'unavailable',
      'This export is not ready or is no longer available. Refresh or start a new export.',
    ],
  ])('toasts the %s download error instead of a page banner', (downloadError, message) => {
    render(<TeamExportPanel exports={[]} downloadError={downloadError} />);

    expect(screen.queryByRole('alert')).toBeNull();
    expect(notify.notifyError).toHaveBeenCalledWith('team-export:download', message);
  });

  it.each(['raw-provider-error', '__proto__', 'toString'])(
    'ignores the unknown %s download error query value',
    (downloadError) => {
      render(<TeamExportPanel exports={[]} downloadError={downloadError} />);

      expect(screen.queryByRole('alert')).toBeNull();
      expect(screen.queryByText(downloadError)).toBeNull();
    },
  );

  it('lists export rows and only exposes download for ready archives', () => {
    render(
      <TeamExportPanel
        exports={[
          {
            id: 'ready-export',
            status: 'ready',
            createdAt: new Date('2026-07-02T10:00:00.000Z'),
            completedAt: new Date('2026-07-02T10:01:00.000Z'),
            expiresAt: new Date('2026-07-03T10:00:00.000Z'),
            error: null,
          },
          {
            id: 'queued-export',
            status: 'queued',
            createdAt: new Date('2026-07-02T11:00:00.000Z'),
            completedAt: null,
            expiresAt: null,
            error: null,
          },
          {
            id: 'failed-export',
            status: 'failed',
            createdAt: new Date('2026-07-02T12:00:00.000Z'),
            completedAt: new Date('2026-07-02T12:01:00.000Z'),
            expiresAt: null,
            error: 'Archive build failed',
          },
        ]}
      />,
    );

    const rows = screen.getAllByRole('listitem');
    expect(rows).toHaveLength(3);
    const [readyRow, queuedRow, failedRow] = rows;
    if (!readyRow || !queuedRow || !failedRow) throw new Error('expected three export rows');
    expect(within(readyRow).getByText('Ready')).toBeTruthy();
    expect(within(readyRow).getByDisplayValue('ready-export')).toBeTruthy();
    expect(within(readyRow).getByRole('button', { name: 'Download' })).toBeTruthy();
    expect(within(queuedRow).getByText('Queued')).toBeTruthy();
    expect(within(queuedRow).queryByRole('button', { name: 'Download' })).toBeNull();
    expect(within(failedRow).getByText('Failed')).toBeTruthy();
    expect(
      within(failedRow).getByText(
        'This export could not be completed. Start a new export or try again later.',
      ),
    ).toBeTruthy();
    const details = within(failedRow).getByText('Technical details').closest('details');
    expect(details?.open).toBe(false);
    expect(details?.textContent).toContain('Archive build failed');
    expect(within(failedRow).queryByRole('button', { name: 'Download' })).toBeNull();
  });
});
