// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CopyButton, copyAnnouncement } from '@/components/copy-button';

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
});
