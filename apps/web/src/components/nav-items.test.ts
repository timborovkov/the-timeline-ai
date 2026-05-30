import { describe, expect, it } from 'vitest';

import { isNavItemActive, visibleNavItems } from '@/components/nav-items';

describe('nav items', () => {
  it('shows Home before Timeline', () => {
    const items = visibleNavItems('member');
    expect(items[0]?.href).toBe('/app');
    expect(items[1]?.href).toBe('/app/timeline');
  });

  it('does not mark Home active for every app route', () => {
    expect(isNavItemActive({ href: '/app' }, '/app')).toBe(true);
    expect(isNavItemActive({ href: '/app' }, '/app/timeline')).toBe(false);
    expect(isNavItemActive({ href: '/app/timeline' }, '/app/timeline')).toBe(true);
  });
});
