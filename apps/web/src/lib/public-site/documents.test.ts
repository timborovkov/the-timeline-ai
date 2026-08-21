import { describe, expect, it } from 'vitest';

import { PUBLIC_DOCUMENT_REGISTRY } from '@/lib/public-site/documents';
import { buildPublicStructuredData } from '@/lib/public-site/structured-data';

describe('core public documents', () => {
  it('keeps the home search metadata concise and names the product entity explicitly', () => {
    const home = PUBLIC_DOCUMENT_REGISTRY.get('/');
    if (!home) throw new Error('Home public document is not registered');

    expect(home).toMatchObject({
      title: 'AI Team Memory With Cited Answers',
      description:
        'Timeline turns selected chats, meetings, documents, tickets, and code into a searchable project history. Ask questions and verify every claim at the source.',
      dates: { modified: '2026-08-21', reviewed: '2026-08-21' },
    });

    const graph = buildPublicStructuredData(home, 'https://thetimeline.cc');
    expect(graph['@graph'].find((node) => node['@type'] === 'SoftwareApplication')).toMatchObject({
      '@type': 'SoftwareApplication',
      name: 'The Timeline',
      url: 'https://thetimeline.cc/',
    });
  });
});
