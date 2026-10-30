import { cleanup, render, screen } from '@testing-library/react';
import { expect } from '@timeline/test-support';
import { vi } from '@timeline/test-support';
import { afterEach, beforeEach, describe, it } from 'bun:test';

import { HomeTeamEmail } from '@/components/home/home-team-email';
// Test environment: happy-dom

describe('HomeTeamEmail', () => {
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

  it('shows a copyable team email and a link to email settings', () => {
    render(<HomeTeamEmail inboundEmail="acme@inbound.timeline.dev" />);

    const section = screen.getByRole('region', { name: 'Team email' });
    expect(section.getAttribute('id')).toBe('team-email');
    expect(screen.getByLabelText<HTMLInputElement>('Team email address').value).toBe(
      'acme@inbound.timeline.dev',
    );
    expect(screen.getByRole('button', { name: 'Copy team email' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Email settings' }).getAttribute('href')).toBe(
      '/app/team?section=email',
    );
  });
});
