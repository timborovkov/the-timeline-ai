// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CopyButton } from '@/components/copy-button';

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

  it('announces successful copies', async () => {
    render(<CopyButton value="token" label="Copy token" />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy token' }));

    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toContain('Copy token copied.');
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
