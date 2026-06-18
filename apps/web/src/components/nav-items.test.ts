import { describe, expect, it } from 'vitest';

import { formatNavBadge, isNavItemActive, visibleNavItems } from '@/components/nav-items';

describe('nav items', () => {
  it('shows Home before Timeline', () => {
    const items = visibleNavItems('member');
    expect(items.map((item) => item.label)).toEqual([
      'Home',
      'Timeline',
      'Ask',
      'Work',
      'Documents',
      'Connections',
      'Team',
    ]);
  });

  it('does not mark Home active for every app route', () => {
    expect(isNavItemActive({ href: '/app' }, '/app')).toBe(true);
    expect(isNavItemActive({ href: '/app' }, '/app/timeline')).toBe(false);
    expect(isNavItemActive({ href: '/app/timeline' }, '/app/timeline')).toBe(true);
  });

  it('groups work and source routes under the simplified parents', () => {
    expect(
      isNavItemActive(
        { href: '/app/work', activeHrefs: ['/app/work', '/app/calendar'] },
        '/app/calendar',
      ),
    ).toBe(true);
    expect(
      isNavItemActive(
        { href: '/app/sources', activeHrefs: ['/app/sources', '/app/team/slack'] },
        '/app/team/slack',
      ),
    ).toBe(true);
  });

  it('does not keep Team active for source routes nested under team settings', () => {
    expect(
      isNavItemActive(
        { href: '/app/team', activeHrefs: ['/app/team', '/app/team/audit', '/app/team/jobs'] },
        '/app/team/slack',
      ),
    ).toBe(false);
    expect(
      isNavItemActive(
        { href: '/app/team', activeHrefs: ['/app/team', '/app/team/audit', '/app/team/jobs'] },
        '/app/team/audit',
      ),
    ).toBe(true);
    expect(
      isNavItemActive(
        { href: '/app/team', activeHrefs: ['/app/team', '/app/team/audit', '/app/team/jobs'] },
        '/app/team/jobs/retries',
      ),
    ).toBe(true);
  });

  it('formats attention badges without rendering zero state', () => {
    expect(formatNavBadge(undefined)).toBeNull();
    expect(formatNavBadge(0)).toBeNull();
    expect(formatNavBadge(7)).toBe('7');
    expect(formatNavBadge(125)).toBe('99+');
  });
});
