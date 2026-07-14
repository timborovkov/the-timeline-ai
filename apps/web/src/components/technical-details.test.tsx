// @vitest-environment happy-dom

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
});
