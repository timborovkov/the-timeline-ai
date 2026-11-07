import { expect } from '@timeline/test-support';
import { describe, it } from 'bun:test';

import { PUBLIC_DOCUMENT_REGISTRY } from '@/lib/public-site/documents';
import { buildPublicStructuredData } from '@/lib/public-site/structured-data';
describe('core public documents', () => {
  it('keeps the home search metadata concise and names the product entity explicitly', () => {
    const home = PUBLIC_DOCUMENT_REGISTRY.get('/');
    if (!home) throw new Error('Home public document is not registered');

    expect(home).toMatchObject({
      title: "Your team's work, written down for you",
      description:
        'The Timeline keeps client, deal, task and decision records up to date from Slack, Telegram, email and calls. Every line has its source, and you approve each change.',
      dates: { modified: '2026-11-07', reviewed: '2026-11-07' },
    });

    const graph = buildPublicStructuredData(home, 'https://thetimeline.cc');
    expect(graph['@graph'].find((node) => node['@type'] === 'SoftwareApplication')).toMatchObject({
      '@type': 'SoftwareApplication',
      name: 'The Timeline',
      url: 'https://thetimeline.cc/',
    });
  });
});
