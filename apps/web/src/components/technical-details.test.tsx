// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TechnicalDetails } from '@/components/technical-details';

describe('TechnicalDetails', () => {
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

  it('is closed by default and opens natively', () => {
    const { container } = render(
      <TechnicalDetails items={[{ label: 'Event ID', value: 'evt_123' }]} />,
    );
    const details = container.querySelector('details');
    expect(details?.open).toBe(false);
    fireEvent.click(screen.getByText('Technical details'));
    expect(details?.open).toBe(true);
  });

  it('copies an explicit technical value and announces the result', async () => {
    render(
      <TechnicalDetails items={[{ label: 'Event ID', value: 'evt_123', copyValue: 'evt_123' }]} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Copy Event ID' }));
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('evt_123');
      const status = screen.getByRole('status');
      expect(status.textContent).toBe('Copied Event ID.');
      expect(status.closest('details')).toBeNull();
    });
  });

  it('reports recovery steps when the Clipboard API is unavailable', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: undefined,
    });
    render(
      <TechnicalDetails items={[{ label: 'Event ID', value: 'evt_123', copyValue: 'evt_123' }]} />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Copy Event ID' }));

    expect(screen.getByRole('button', { name: 'Copy Event ID' }).textContent).toContain('Copy');
    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toBe(
        'Could not copy. Try again or select the text and copy it manually.',
      );
      expect(screen.getByRole('status').className).toContain('text-danger');
    });
  });

  it('clears a prior success and reports recovery steps when clipboard permission is denied', async () => {
    render(
      <TechnicalDetails items={[{ label: 'Event ID', value: 'evt_123', copyValue: 'evt_123' }]} />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Copy Event ID' }));
    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toBe('Copied Event ID.');
    });

    writeText.mockRejectedValueOnce(new Error('Permission denied'));
    fireEvent.click(screen.getByRole('button', { name: 'Copy Event ID' }));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledTimes(2);
      expect(screen.getByRole('status').textContent).toBe(
        'Could not copy. Try again or select the text and copy it manually.',
      );
    });
    expect(screen.getByRole('button', { name: 'Copy Event ID' }).textContent).toContain('Copy');
  });
});
