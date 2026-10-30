import { cleanup, render, screen } from '@testing-library/react';
import { expect } from '@timeline/test-support';
import { vi } from '@timeline/test-support';
import { afterEach, beforeEach, describe, it } from 'bun:test';

import { CopyableTextField } from '@/components/copyable-text-field';
// Test environment: happy-dom

describe('CopyableTextField', () => {
  beforeEach(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders one selectable field with a copy control when configured', () => {
    render(
      <CopyableTextField
        id="team-email"
        label="Team email address"
        value="acme@inbound.timeline.dev"
        description="Forward, CC, or BCC mail here."
      />,
    );

    const field = screen.getByLabelText<HTMLInputElement>('Team email address');
    expect(field.readOnly).toBe(true);
    expect(field.value).toBe('acme@inbound.timeline.dev');
    expect(screen.getByRole('button', { name: 'Copy Team email address' })).toBeTruthy();
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
