import {
  CONNECTORS,
  type ConnectorContent,
} from '@/components/marketing/integrations/connector-content';
import {
  findConnectorPublicDocument,
  INTEGRATION_DIRECTORY_DOCUMENT,
} from '@/components/marketing/integrations/connector-public-documents';
import { buildPublicStructuredData, stringifyJsonLdForHtml } from '@/lib/public-site';
import { getSiteUrl } from '@/lib/site-url';

export function stringifyStructuredData(value: unknown): string {
  return stringifyJsonLdForHtml(value);
}

export function connectorStructuredData(connector: ConnectorContent, siteUrl = getSiteUrl()) {
  return buildPublicStructuredData(findConnectorPublicDocument(connector), siteUrl);
}

export function directoryStructuredData(siteUrl = getSiteUrl()) {
  const canonical = new URL('/integrations', siteUrl).toString();
  const graph = buildPublicStructuredData(INTEGRATION_DIRECTORY_DOCUMENT, siteUrl);

  return {
    ...graph,
    '@graph': [
      ...graph['@graph'],
      {
        '@type': 'ItemList',
        '@id': `${canonical}#connectors`,
        numberOfItems: CONNECTORS.length,
        itemListElement: CONNECTORS.map((connector, index) => ({
          '@type': 'ListItem',
          position: index + 1,
          name: connector.name,
          url: new URL(`/integrations/${connector.slug}`, siteUrl).toString(),
        })),
      },
    ],
  };
}
