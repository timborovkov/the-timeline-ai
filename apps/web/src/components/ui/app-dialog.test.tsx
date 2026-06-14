// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { useAppDialog } from './app-dialog.js';

afterEach(() => {
  cleanup();
});

function DialogHarness() {
  const dialog = useAppDialog();
  const [result, setResult] = useState('idle');

  return (
    <div>
      <button
        type="button"
        onClick={() => {
          void dialog.alert({ title: 'Heads up', description: 'Saved.' }).then(() => {
            setResult('alerted');
          });
        }}
      >
        Alert
      </button>
      <button
        type="button"
        onClick={() => {
          void dialog
            .confirm({
              title: 'Delete item?',
              description: 'This removes the item.',
              confirmLabel: 'Delete',
              destructive: true,
            })
            .then((confirmed) => {
              setResult(confirmed ? 'confirmed' : 'cancelled');
            });
        }}
      >
        Confirm
      </button>
      <button
        type="button"
        onClick={() => {
          void dialog
            .input({
              title: 'Rename',
              description: 'Set a display name.',
              inputLabel: 'Name',
              defaultValue: 'Old',
              confirmLabel: 'Rename',
            })
            .then((value) => {
              setResult(value ?? 'cancelled');
            });
        }}
      >
        Input
      </button>
      <span>{result}</span>
      {dialog.node}
    </div>
  );
}

describe('useAppDialog', () => {
  it('resolves alert, confirm, and input flows without browser dialogs', async () => {
    const user = userEvent.setup();
    render(<DialogHarness />);

    await user.click(screen.getByRole('button', { name: 'Alert' }));
    expect(screen.getByText('Saved.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'OK' }));
    await waitFor(() => expect(screen.getByText('alerted')).toBeTruthy());

    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(screen.getByText('This removes the item.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(screen.getByText('confirmed')).toBeTruthy());

    await user.click(screen.getByRole('button', { name: 'Input' }));
    const input = screen.getByLabelText('Name');
    await user.clear(input);
    await user.type(input, 'New name');
    await user.click(screen.getByRole('button', { name: 'Rename' }));
    await waitFor(() => expect(screen.getByText('New name')).toBeTruthy());
  });

  it('submits the live input value when Enter is pressed before state catches up', async () => {
    const user = userEvent.setup();
    render(<DialogHarness />);

    await user.click(screen.getByRole('button', { name: 'Input' }));
    const input = screen.getByLabelText<HTMLInputElement>('Name');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(
      input,
      'Fresh name',
    );
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(screen.getByText('Fresh name')).toBeTruthy());
  });
});
