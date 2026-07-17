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
  updateInboundEmailWhitelistAction: vi.fn(),
  updateTeamTimezoneAction: vi.fn(),
}));

const { InboundEmailWhitelistForm, InviteMemberForm, TeamExportPanel } =
  await import('./team-forms.js');

beforeEach(() => {
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

    expect(screen.getByText('acme@inbound.timeline.dev')).toBeTruthy();
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

    expect(screen.getByText('Not configured')).toBeTruthy();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Working…' }).disabled).toBe(true);
    expect(screen.getByText('Email settings updated.')).toBeTruthy();

    fakes.useActionState.mockReturnValue([
      { error: 'Only admins can change inbound email settings.' },
      fakes.action,
    ]);
    fakes.useFormStatus.mockReturnValue({ pending: false });
    render(<InboundEmailWhitelistForm inboundEmail={null} enabled={false} senders={[]} />);

    expect(screen.getByText('Only admins can change inbound email settings.')).toBeTruthy();
  });
});

describe('InviteMemberForm', () => {
  it('limits admin invites when the current member cannot invite admins', () => {
    render(<InviteMemberForm canInviteAdmin={false} />);

    const role = screen.getByLabelText<HTMLSelectElement>('Role');
    expect([...role.options].map((option) => option.value)).toEqual(['member']);
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
    expect(screen.getByText('Invite email sent.')).toBeTruthy();

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
    expect(screen.getByText(/Email was not sent: Postmark rejected the recipient/)).toBeTruthy();
    expect(screen.getByText(/The link still works/)).toBeTruthy();
  });

  it('shows validation and permission errors next to the invite form', () => {
    fakes.useActionState.mockReturnValue([
      { error: 'Only admins can invite members.' },
      fakes.action,
    ]);

    render(<InviteMemberForm canInviteAdmin={false} />);

    expect(screen.getByText('Only admins can invite members.')).toBeTruthy();
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

    render(<TeamExportPanel exports={[]} />);

    expect(screen.getByText('Export queued.')).toBeTruthy();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Working…' }).disabled).toBe(true);

    fakes.useActionState.mockReturnValue([
      { error: 'Only owners and admins can export team data' },
      fakes.action,
    ]);
    fakes.useFormStatus.mockReturnValue({ pending: false });
    render(<TeamExportPanel exports={[]} />);

    expect(screen.getByText('Only owners and admins can export team data')).toBeTruthy();
  });

  it.each([
    ['invalid', 'That export link is invalid. Refresh and try again.'],
    ['forbidden', 'You no longer have permission to download team exports.'],
    [
      'unavailable',
      'This export is not ready or is no longer available. Refresh or start a new export.',
    ],
  ])('shows the %s download error inside the export panel', (downloadError, message) => {
    render(<TeamExportPanel exports={[]} downloadError={downloadError} />);

    expect(screen.getByRole('alert').textContent).toBe(message);
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
    expect(within(readyRow).getByText('ready')).toBeTruthy();
    expect(within(readyRow).getByDisplayValue('ready-export')).toBeTruthy();
    expect(within(readyRow).getByRole('button', { name: 'Download' })).toBeTruthy();
    expect(within(queuedRow).getByText('queued')).toBeTruthy();
    expect(within(queuedRow).queryByRole('button', { name: 'Download' })).toBeNull();
    expect(within(failedRow).getByText('failed')).toBeTruthy();
    expect(within(failedRow).getByText('Archive build failed')).toBeTruthy();
    expect(within(failedRow).queryByRole('button', { name: 'Download' })).toBeNull();
  });
});
