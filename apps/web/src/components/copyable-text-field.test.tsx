import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect } from '@timeline/test-support';
import { vi } from '@timeline/test-support';
import { afterEach, beforeEach, describe, it } from 'bun:test';

import { CopyableTextField } from '@/components/copyable-text-field';
// Test environment: happy-dom

describe('CopyableTextField', () => {
  const writeText = vi.fn<(value: string) => Promise<void>>();
  beforeEach(() => {
    writeText.mockReset();
    writeText.mockResolvedValue();
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('copies the entire selectable value with an icon-only control', async () => {
    const value = 'very-long-disposable-workspace-email-address@inbound.example.test';
    render(
      <CopyableTextField
        id="team-email"
        label="Team email address"
        value={value}
        description="Forward, CC, or BCC mail here."
      />,
    );

    const field = screen.getByLabelText<HTMLInputElement>('Team email address');
    expect(field.readOnly).toBe(true);
    expect(field.value).toBe(value);
    fireEvent.focus(field);
    expect(field.selectionStart).toBe(0);
    expect(field.selectionEnd).toBe(value.length);

    const copy = screen.getByRole('button', { name: 'Copy Team email address' });
    const status = screen.getByRole('status');
    expect(copy.textContent).toBe('');
    expect(status.textContent).toBe('');
    fireEvent.click(copy);
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(value);
      expect(status.textContent).toBe('Copied Team email address.');
    });
    expect(copy.textContent).toBe('');
    expect(screen.getByText('Forward, CC, or BCC mail here.')).toBeTruthy();
  });

  it('shows empty state without a copy control', () => {
    render(<CopyableTextField id="team-email" label="Team email address" value={null} />);

    expect(screen.getByLabelText<HTMLInputElement>('Team email address').value).toBe(
      'Not configured',
    );
    expect(screen.queryByRole('button', { name: /copy/i })).toBeNull();
  });
});
