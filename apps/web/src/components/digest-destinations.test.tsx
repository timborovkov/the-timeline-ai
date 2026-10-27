import { expect } from '@timeline/test-support';
import { vi } from '@timeline/test-support';
import { afterEach, beforeEach, describe, it } from 'bun:test';

import type * as ReactModule from 'react';
import type * as ReactDomModule from 'react-dom';
// Test environment: happy-dom

const fakes = vi.hoisted(() => ({
  action: vi.fn(),
  useActionState: vi.fn(),
  useFormStatus: vi.fn(),
}));

await vi.mock(
  import.meta.resolve('react'),
  async (importOriginal) => {
    const actual = await importOriginal<typeof ReactModule>();
    return {
      ...actual,
      useActionState: fakes.useActionState,
    };
  },
  () => import('react'),
);

await vi.mock(
  import.meta.resolve('react-dom'),
  async (importOriginal) => {
    const actual = await importOriginal<typeof ReactDomModule>();
    return {
      ...actual,
      useFormStatus: fakes.useFormStatus,
    };
  },
  () => import('react-dom'),
);

await vi.mock(
  import.meta.resolve('@/app/actions/teams'),
  () => ({
    addDigestDestinationAction: vi.fn(),
    removeDigestDestinationAction: vi.fn(),
  }),
  () => import('@/app/actions/teams'),
);

const { cleanup, render, screen } = await import('@testing-library/react');

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
    expect(screen.getByRole('group', { name: 'Remove Slack #general' })).toBeTruthy();
    const add = screen.getByLabelText<HTMLSelectElement>('Add destination');
    expect([...add.options].map((option) => option.textContent)).toEqual([
      'Email every member',
      'Telegram DM every linked member',
    ]);
  });
});
