// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react';
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

vi.mock('@/app/actions/teams', () => ({
  addDigestDestinationAction: vi.fn(),
  removeDigestDestinationAction: vi.fn(),
}));

const { DigestDestinationsForm } = await import('./digest-destinations.js');

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

describe('DigestDestinationsForm', () => {
  it('lists configured destinations and remaining add options', () => {
    render(
      <DigestDestinationsForm
        destinations={[
          {
            id: 'dest-1',
            kind: 'slack_channel',
            targetId: 'C123',
            label: '#general',
          },
        ]}
        options={[
          { kind: 'email_members', label: 'Email every member' },
          { kind: 'slack_channel', targetId: 'C123', label: 'Slack #general' },
          { kind: 'telegram_dm_members', label: 'Telegram DM every linked member' },
        ]}
      />,
    );

    expect(screen.getByText('Slack #general')).toBeTruthy();
    const add = screen.getByLabelText<HTMLSelectElement>('Add destination');
    expect([...add.options].map((option) => option.textContent)).toEqual([
      'Email every member',
      'Telegram DM every linked member',
    ]);
  });
});
