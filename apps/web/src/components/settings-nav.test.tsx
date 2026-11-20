import { cleanup, render, screen } from '@testing-library/react';
import { expect } from '@timeline/test-support';
import { afterEach, describe, it } from 'bun:test';

import { SettingsNav } from '@/components/settings-nav';
// Test environment: happy-dom

const items = [
  { value: 'members', label: 'Members' },
  { value: 'general', label: 'General' },
  { value: 'advanced', label: 'Advanced', adminOnly: true },
];

describe('SettingsNav', () => {
  afterEach(cleanup);

  it('uses URL-backed sections and touch-sized links in a responsive navigation', () => {
    render(<SettingsNav items={items} activeSection="general" />);

    const navigation = screen.getByRole('navigation', { name: 'Team settings' });
    expect(navigation.className).toContain('overflow-x-auto');
    expect(navigation.className).toContain('scroll-px-3');
    expect(navigation.className).toContain('lg:w-52');
    const general = screen.getByRole('link', { name: 'General' });
    expect(general.getAttribute('href')).toBe('/app/team?section=general');
    expect(general.getAttribute('aria-current')).toBe('page');
    expect(general.className).toContain('min-h-11');
    expect(general.className).toContain('lg:min-h-8');
    expect(screen.queryByRole('link', { name: 'Advanced' })).toBeNull();
  });

  it('marks the active administrator section for administrators', () => {
    render(<SettingsNav items={items} activeSection="advanced" isAdmin />);

    expect(screen.getByRole('link', { name: 'Advanced' }).getAttribute('aria-current')).toBe(
      'page',
    );
  });
});
