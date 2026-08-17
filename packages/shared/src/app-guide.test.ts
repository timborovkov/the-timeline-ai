import { describe, expect, it } from 'vitest';

import { getAppGuideRoute, searchAppGuide } from '#src/app-guide.js';

describe('app guide route metadata', () => {
  it('looks up exact route metadata with role and href', () => {
    expect(getAppGuideRoute('team/invites')).toMatchObject({
      id: 'team/invites',
      title: 'Invite Team Members',
      href: '/app/team',
      minRole: 'admin',
    });
  });

  it('returns null for unknown route ids', () => {
    expect(getAppGuideRoute('team/secret-admin')).toBeNull();
  });

  it('searches product guide routes for user intent queries', () => {
    const results = searchAppGuide('where can I invite new teammates?', 8);

    expect(results[0]).toMatchObject({
      id: 'team/invites',
      citation: '[route:team/invites]',
      minRole: 'admin',
    });
    expect(results.map((result) => result.id)).toContain('team');
  });

  it('searches usage-guide content, not only route labels', () => {
    const results = searchAppGuide('how do document citations and versions work?', 3);

    expect(results.map((result) => result.id)).toContain('help/documents');
    expect(results[0]?.citation).toMatch(/^\[route:/);
  });

  it('routes Work-surface questions to the Work guide', () => {
    const results = searchAppGuide('where are updates digests handoffs and boards?', 5);

    expect(results.map((result) => result.id)).toContain('help/work');
    expect(results.map((result) => result.id)).toContain('work');
  });

  it('routes connection setup questions to Connections and provider accounts', () => {
    const results = searchAppGuide('where do I connect slack or my github account?', 6);

    expect(results.map((result) => result.id)).toEqual(
      expect.arrayContaining(['connections', 'me/connections', 'team/slack']),
    );
  });

  it('routes Monday.com board, subitem, and WorkDoc questions to integrations', () => {
    const results = searchAppGuide('where do I choose monday boards subitems and WorkDocs?', 5);

    expect(results[0]).toMatchObject({
      id: 'team/integrations/monday',
      citation: '[route:team/integrations/monday]',
      minRole: 'admin',
    });
  });
});
