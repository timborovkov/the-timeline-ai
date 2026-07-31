// @vitest-environment happy-dom

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { SettingsNav } from '@/components/settings-nav';

const items = [
  { value: 'members', label: 'Members' },
  { value: 'general', label: 'General' },
  { value: 'advanced', label: 'Advanced', adminOnly: true },
];

describe('SettingsNav', () => {
  it('uses URL-backed sections with a responsive Team settings navigation label', () => {
    render(<SettingsNav items={items} activeSection="general" />);

    const navigation = screen.getByRole('navigation', { name: 'Team settings' });
    expect(navigation.className).toContain('overflow-x-auto');
    expect(navigation.className).toContain('lg:w-52');
    expect(navigation.firstElementChild?.className).toContain('lg:flex-col');
    expect(screen.getByRole('link', { name: 'General' }).getAttribute('href')).toBe(
      '/app/team?section=general',
    );
    expect(screen.getByRole('link', { name: 'General' }).getAttribute('aria-current')).toBe('page');
    expect(screen.queryByRole('link', { name: 'Advanced' })).toBeNull();
  });

  it('shows administrator sections only to administrators', () => {
    render(<SettingsNav items={items} activeSection="advanced" isAdmin />);

    expect(screen.getByRole('link', { name: 'Advanced' }).getAttribute('aria-current')).toBe(
      'page',
    );
  });
});
