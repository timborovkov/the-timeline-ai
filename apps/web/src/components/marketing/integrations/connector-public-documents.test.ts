import { describe, expect, it } from 'vitest';

import { CAPTURE_SURFACES } from '@/components/marketing/integrations/capture-surface-content';
import { CONNECTORS } from '@/components/marketing/integrations/connector-content';
import {
  CONNECTOR_PUBLIC_DOCUMENTS,
  INTEGRATION_DIRECTORY_DOCUMENT,
  findConnectorPublicDocument,
} from '@/components/marketing/integrations/connector-public-documents';
import { PUBLIC_DOCUMENT_REGISTRY } from '@/lib/public-site';

describe('connector public documents', () => {
  it('contributes the directory and six native connector routes to public discovery', () => {
    expect(CONNECTOR_PUBLIC_DOCUMENTS.documents.map((document) => document.canonicalPath)).toEqual([
      '/integrations',
      ...CONNECTORS.map((connector) => `/integrations/${connector.slug}`),
    ]);
    expect(
      CONNECTOR_PUBLIC_DOCUMENTS.documents.filter((document) => document.kind === 'connector'),
    ).toHaveLength(6);
    for (const document of CONNECTOR_PUBLIC_DOCUMENTS.documents) {
      expect(PUBLIC_DOCUMENT_REGISTRY.get(document.canonicalPath)).toBe(document);
    }
  });

  it('publishes capture-surface truth without inventing additional connector routes', () => {
    const serialized = JSON.stringify(INTEGRATION_DIRECTORY_DOCUMENT);

    expect(INTEGRATION_DIRECTORY_DOCUMENT.dates).toEqual({
      modified: '2026-08-15',
      reviewed: '2026-08-15',
    });
    for (const surface of CAPTURE_SURFACES) {
      expect(serialized).toContain(surface.name);
    }
    expect(CONNECTOR_PUBLIC_DOCUMENTS.documents).toHaveLength(CONNECTORS.length + 1);
  });

  it('derives metadata, capability, structured data, and LLM content from connector truth', () => {
    for (const connector of CONNECTORS) {
      const document = findConnectorPublicDocument(connector);
      expect(document.title).toBe(connector.seoTitle);
      expect(document.description).toBe(connector.seoDescription);
      expect(document.dates.reviewed).toBe(connector.lastReviewed);
      expect(document.capability).toEqual({
        kind: 'native-ingestion',
        provider: connector.slug,
      });
      expect(document.structuredData).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: 'faq', entries: connector.faqs }),
          expect.objectContaining({ type: 'software-application', name: 'The Timeline' }),
        ]),
      );
      expect(document.llms && document.llms.section).toBe('integrations');
      expect(JSON.stringify(document.llms)).toContain(connector.limitations[0]);
    }
  });
});
