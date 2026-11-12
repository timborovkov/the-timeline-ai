import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect } from '@timeline/test-support';
import { vi } from '@timeline/test-support';
import { afterEach, beforeEach, describe, it } from 'bun:test';

import { CopyButton } from '@/components/copy-button';
import { copyAnnouncement } from '@/lib/copy-announcement';
// Test environment: happy-dom

describe('copyAnnouncement', () => {
  it('names the copied value when the label has a noun', () => {
    expect(copyAnnouncement('Copy token')).toBe('Copied token.');
    expect(copyAnnouncement('Event ID')).toBe('Copied Event ID.');
    expect(copyAnnouncement('Copy')).toBe('Copied.');
  });
});

describe('CopyButton', () => {
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
  });

  it('swaps the icon and label after a successful copy', async () => {
    render(<CopyButton value="token" label="Copy token" />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy token' }));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('token');
      expect(screen.getByRole('button', { name: 'Copy token' }).textContent).toContain('Copied');
      expect(screen.getByRole('status').textContent).toBe('Copied token.');
    });
  });

  it('announces unavailable and denied clipboard access', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: undefined,
    });
    render(<CopyButton value="token" label="Copy token" />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy token' }));
    await waitFor(() => {
      const error = screen.getByRole('status');
      expect(error.textContent).toContain(
        'Could not copy. Try again or select the text and copy it manually.',
      );
      expect(error.className).not.toContain('sr-only');
    });

    cleanup();
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    writeText.mockRejectedValueOnce(new Error('Permission denied'));
    render(<CopyButton value="token" label="Copy token" />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy token' }));
    await waitFor(() => {
      const error = screen.getByRole('status');
      expect(error.textContent).toContain(
        'Could not copy. Try again or select the text and copy it manually.',
      );
      expect(error.className).not.toContain('sr-only');
    });
  });
  it('clears copy feedback when the value changes', async () => {
    const { rerender } = render(<CopyButton value="old-link" label="Copy invite link" />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy invite link' }));
    await waitFor(() => {
      expect(screen.getByRole('button').textContent).toContain('Copied');
    });
    rerender(<CopyButton value="new-link" label="Copy invite link" />);
    expect(screen.getByRole('button').textContent).not.toContain('Copied');
    expect(screen.getByRole('status').textContent).toBe('');
  });

  it('ignores an older clipboard result after a newer attempt fails', async () => {
    let finishFirst: () => void = () => undefined;
    writeText.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishFirst = resolve;
        }),
    );
    writeText.mockRejectedValueOnce(new Error('Permission denied'));
    render(<CopyButton value="token" label="Copy token" />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy token' }));
    fireEvent.click(screen.getByRole('button', { name: 'Copy token' }));
    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toContain('Could not copy');
    });
    await act(async () => {
      finishFirst();
      await writeText.mock.results[0]?.value;
    });
    expect(screen.getByRole('button').textContent).not.toContain('Copied');
    expect(screen.getByRole('status').textContent).toContain('Could not copy');
  });
  it('ignores a pending result for a replaced value without losing button focus', async () => {
    let finish: () => void = () => undefined;
    writeText.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const { rerender } = render(<CopyButton value="old-link" label="Copy link" />);
    const button = screen.getByRole('button', { name: 'Copy link' });
    button.focus();
    fireEvent.click(button);
    rerender(<CopyButton value="new-link" label="Copy link" />);
    await act(async () => {
      finish();
      await writeText.mock.results[0]?.value;
    });
    expect(button.textContent).not.toContain('Copied');
    expect(screen.getByRole('status').textContent).toBe('');
    expect(document.activeElement).toBe(button);
    fireEvent.click(button);
    await waitFor(() => {
      expect(writeText).toHaveBeenLastCalledWith('new-link');
    });
    await waitFor(() => {
      expect(button.textContent).toContain('Copied');
    });
  });
  it('keeps public copy controls named and reports success and failure without replacing the button', async () => {
    render(<CopyButton publicFeedback value="setup-command" label="Copy a long setup command" />);
    const button = screen.getByRole('button', { name: 'Copy a long setup command' });
    button.focus();
    fireEvent.click(button, { detail: 1 });
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toBe('Copied a long setup command.'),
    );
    expect(document.activeElement).toBe(button);
    expect(button.querySelector('[aria-hidden="true"]')).not.toBeNull();
    writeText.mockRejectedValueOnce(new Error('Permission denied'));
    fireEvent.click(button);
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Could not copy'));
    expect(document.activeElement).toBe(button);
  });
});
