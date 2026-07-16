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

  it('copies an explicit technical value', () => {
    render(
      <TechnicalDetails items={[{ label: 'Event ID', value: 'evt_123', copyValue: 'evt_123' }]} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Copy Event ID' }));
    expect(writeText).toHaveBeenCalledWith('evt_123');
  });

  it('keeps Copy available without throwing when the Clipboard API is unavailable', () => {
    Reflect.deleteProperty(navigator, 'clipboard');
    render(
      <TechnicalDetails items={[{ label: 'Event ID', value: 'evt_123', copyValue: 'evt_123' }]} />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Copy Event ID' }));

    expect(screen.getByRole('button', { name: 'Copy Event ID' }).textContent).toContain('Copy');
  });

  it('does not report a successful copy when clipboard permission is denied', async () => {
    writeText.mockRejectedValueOnce(new Error('Permission denied'));
    render(
      <TechnicalDetails items={[{ label: 'Event ID', value: 'evt_123', copyValue: 'evt_123' }]} />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Copy Event ID' }));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('evt_123');
    });
    expect(screen.getByRole('button', { name: 'Copy Event ID' }).textContent).toContain('Copy');
  });
});
