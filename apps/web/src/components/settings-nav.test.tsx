// @vitest-environment happy-dom

import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SettingsNav } from '@/components/settings-nav';

const items = [
  { value: 'members', label: 'Members' },
  { value: 'general', label: 'General' },
  { value: 'advanced', label: 'Advanced', adminOnly: true },
];

describe('SettingsNav', () => {
  const scrollIntoView = vi.fn();
  let originalScrollIntoView: PropertyDescriptor | undefined;

  beforeEach(() => {
    scrollIntoView.mockReset();
    originalScrollIntoView = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      'scrollIntoView',
    );
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    });
  });

  afterEach(() => {
    if (originalScrollIntoView) {
      Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', originalScrollIntoView);
      return;
    }
    delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  });

  it('uses URL-backed sections with a mobile overflow cue and touch-sized links', () => {
    render(<SettingsNav items={items} activeSection="general" />);

    const navigation = screen.getByRole('navigation', { name: 'Team settings' });
    expect(navigation.className).toContain('overflow-x-auto');
    expect(navigation.className).toContain('scroll-px-3');
    expect(navigation.className).toContain('lg:w-52');
    expect(navigation.getAttribute('aria-describedby')).toBeNull();
    expect(
      screen.getByText('Swipe or scroll to see more settings.').getAttribute('aria-hidden'),
    ).toBe('true');
    const general = screen.getByRole('link', { name: 'General' });
    expect(general.getAttribute('href')).toBe('/app/team?section=general');
    expect(general.getAttribute('aria-current')).toBe('page');
    expect(general.className).toContain('min-h-10');
    expect(general.className).toContain('lg:min-h-8');
    expect(screen.queryByRole('link', { name: 'Advanced' })).toBeNull();
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest' });
  });

  it('shows administrator sections only to administrators and reveals the active destination', () => {
    render(<SettingsNav items={items} activeSection="advanced" isAdmin />);

    expect(screen.getByRole('link', { name: 'Advanced' }).getAttribute('aria-current')).toBe(
      'page',
    );
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest' });
  });
});
