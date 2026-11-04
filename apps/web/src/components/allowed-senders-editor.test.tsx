import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect } from '@timeline/test-support';
import { afterEach, describe, it } from 'bun:test';

import { AllowedSendersEditor } from '@/components/allowed-senders-editor';
import { parseAllowedSender } from '@/lib/allowed-senders';

afterEach(() => {
  cleanup();
});

describe('parseAllowedSender', () => {
  it('lowercases valid addresses and rejects blanks, invalid values, and domains', () => {
    expect(parseAllowedSender('  Ada@Example.COM ')).toEqual({
      ok: true,
      value: 'ada@example.com',
    });
    expect(parseAllowedSender('')).toEqual({ ok: false });
    expect(parseAllowedSender('nope')).toEqual({ ok: false });
    expect(parseAllowedSender('@tecci.fi')).toEqual({ ok: false });
  });
});

describe('AllowedSendersEditor', () => {
  it('adds on button click and Enter, lowercases, and rejects duplicates and invalid values', async () => {
    const user = userEvent.setup();
    render(<AllowedSendersEditor senders={['ada@example.com']} />);

    expect(screen.getByText('ada@example.com')).toBeTruthy();

    const field = screen.getByLabelText('Additional senders');
    await user.type(field, 'Ada@Example.com');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    expect(screen.getByRole('alert').textContent).toBe('That address is already on the list');

    await user.clear(field);
    await user.type(field, 'not-an-email');
    await user.keyboard('{Enter}');
    expect(screen.getByRole('alert').textContent).toBe('Enter a valid email address');

    await user.clear(field);
    await user.type(field, 'Vendor@Example.net');
    await user.keyboard('{Enter}');
    expect(screen.getByText('vendor@example.net')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(document.querySelector('input[name="senders"]')?.getAttribute('value')).toBe(
      'ada@example.com\nvendor@example.net',
    );

    await user.click(screen.getByRole('button', { name: 'Remove ada@example.com' }));
    expect(screen.queryByText('ada@example.com')).toBeNull();
    expect(document.querySelector('input[name="senders"]')?.getAttribute('value')).toBe(
      'vendor@example.net',
    );
  });
});
