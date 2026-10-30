import { expect } from '@timeline/test-support';
import { describe, it } from 'bun:test';

import { appMetadataForTeam } from '@/lib/app-metadata';
describe('appMetadataForTeam', () => {
  it('includes the active team in app page title templates', () => {
    expect(appMetadataForTeam('Tecci')).toMatchObject({
      robots: { index: false, follow: false },
      title: {
        default: 'Tecci · The Timeline',
        template: '%s · Tecci · The Timeline',
      },
    });
  });

  it('keeps a product title fallback before the team is known', () => {
    expect(appMetadataForTeam(null)).toMatchObject({
      robots: { index: false, follow: false },
      title: {
        default: 'The Timeline',
        template: '%s · The Timeline',
      },
    });
  });
});
