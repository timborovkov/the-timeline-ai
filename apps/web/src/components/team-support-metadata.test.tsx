import { cleanup, render, screen } from '@testing-library/react';
import { expect } from '@timeline/test-support';
import { vi } from '@timeline/test-support';
import { afterEach, beforeEach, describe, it } from 'bun:test';

import { TeamSupportMetadata } from '@/components/team-support-metadata';
// Test environment: happy-dom

describe('TeamSupportMetadata', () => {
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

  it('shows readonly copyable team id and slug without extra card chrome', () => {
    const { container } = render(
      <TeamSupportMetadata teamId="2c386031-488d-5259-90e8-e00b5addb571" teamSlug="acme-labs" />,
    );

    const teamId = screen.getByLabelText<HTMLInputElement>('Team id');
    const teamSlug = screen.getByLabelText<HTMLInputElement>('Team slug');
    expect(teamId.readOnly).toBe(true);
    expect(teamSlug.readOnly).toBe(true);
    expect(teamId.value).toBe('2c386031-488d-5259-90e8-e00b5addb571');
    expect(teamSlug.value).toBe('acme-labs');
    expect(screen.getByRole('button', { name: 'Copy team id' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Copy team slug' })).toBeTruthy();
    expect(container.querySelector('[class*="rounded-md border"]')).toBeNull();
    expect(container.querySelector('[class*="border-y"]')).toBeNull();
  });
});
