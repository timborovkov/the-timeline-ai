// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HomeTeamEmail } from '@/components/home/home-team-email';

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

    expect(screen.getByRole('region', { name: 'Team email' })).toBeTruthy();
    expect(screen.getByLabelText<HTMLInputElement>('Team email address').value).toBe(
      'acme@inbound.timeline.dev',
    );
    expect(screen.getByRole('button', { name: 'Copy team email' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Email settings' }).getAttribute('href')).toBe(
      '/app/team?section=email',
    );
  });
});
