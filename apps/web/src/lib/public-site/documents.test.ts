import { expect } from '@timeline/test-support';
import { describe, it } from 'bun:test';

import { PUBLIC_DOCUMENT_REGISTRY } from '@/lib/public-site/documents';
import { buildPublicStructuredData } from '@/lib/public-site/structured-data';
describe('core public documents', () => {
  it('keeps the home search metadata concise and names the product entity explicitly', () => {
    const home = PUBLIC_DOCUMENT_REGISTRY.get('/');
    if (!home) throw new Error('Home public document is not registered');

    expect(home).toMatchObject({
      title: 'A shared work record for teams and their AI agents',
      description:
        'Know what changed, what was agreed, and what still needs doing with a source-linked work record shared by people and AI agents.',
      dates: { modified: '2026-11-24', reviewed: '2026-11-24' },
    });

    const graph = buildPublicStructuredData(home, 'https://thetimeline.cc');
    expect(graph['@graph'].find((node) => node['@type'] === 'SoftwareApplication')).toMatchObject({
      '@type': 'SoftwareApplication',
      name: 'The Timeline',
      url: 'https://thetimeline.cc/',
    });
  });
});
