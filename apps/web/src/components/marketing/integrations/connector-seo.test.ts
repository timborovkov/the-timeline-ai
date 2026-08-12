import { describe, expect, it } from 'vitest';

import { CONNECTORS } from '@/components/marketing/integrations/connector-content';
import {
  connectorStructuredData,
  directoryStructuredData,
  stringifyStructuredData,
} from '@/components/marketing/integrations/connector-structured-data';

describe('connector structured data', () => {
  it('derives each connector graph from the same content manifest', () => {
    const connector = CONNECTORS.find((item) => item.slug === 'sentry');
    if (!connector) throw new Error('expected Sentry connector');

    const graph = connectorStructuredData(connector, 'https://timeline.test');
    const serialized = JSON.stringify(graph);

    expect(serialized).toContain('https://timeline.test/integrations/sentry');
    expect(serialized).toContain(connector.seoTitle);
    expect(serialized).toContain(connector.lastReviewed);
    expect(serialized).toContain('FAQPage');
    expect(serialized).toContain(connector.faqs[0]?.question);
    expect(serialized).toContain(connector.capturedRecords[0]);
  });

  it('lists only the six published native connectors in the directory graph', () => {
    const serialized = JSON.stringify(directoryStructuredData('https://timeline.test'));
    expect(serialized).toContain('numberOfItems\":6');
    expect(serialized).toContain('/integrations/google-drive');
    expect(serialized).not.toContain('/integrations/notion');
  });

  it('escapes characters that could break the JSON script boundary', () => {
    const output = stringifyStructuredData({ value: '</script>&' });
    expect(output).toBe('{"value":"\\u003c/script\\u003e\\u0026"}');
  });
});
