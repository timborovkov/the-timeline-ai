import {
  CONNECTORS,
  type ConnectorContent,
} from '@/components/marketing/integrations/connector-content';
import { getSiteUrl } from '@/lib/site-url';

const JSON_SCRIPT_ESCAPES: Record<string, string> = {
  '<': '\\u003c',
  '>': '\\u003e',
  '&': '\\u0026',
};

export function stringifyStructuredData(value: unknown): string {
  return JSON.stringify(value).replace(/[<>&]/g, (char) => JSON_SCRIPT_ESCAPES[char] ?? char);
}

export function connectorStructuredData(connector: ConnectorContent, siteUrl = getSiteUrl()) {
  const canonical = new URL(`/integrations/${connector.slug}`, siteUrl).toString();
  const directory = new URL('/integrations', siteUrl).toString();
  const logo = new URL(connector.logo, siteUrl).toString();

  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebPage',
        '@id': `${canonical}#webpage`,
        url: canonical,
        name: connector.seoTitle,
        description: connector.seoDescription,
        dateModified: connector.lastReviewed,
        breadcrumb: { '@id': `${canonical}#breadcrumbs` },
        about: { '@id': `${canonical}#integration` },
      },
      {
        '@type': 'SoftwareApplication',
        '@id': `${canonical}#integration`,
        name: `The Timeline for ${connector.name}`,
        applicationCategory: 'BusinessApplication',
        operatingSystem: 'Web',
        description: connector.seoDescription,
        url: canonical,
        image: logo,
        featureList: connector.capturedRecords,
      },
      {
        '@type': 'BreadcrumbList',
        '@id': `${canonical}#breadcrumbs`,
        itemListElement: [
          {
            '@type': 'ListItem',
            position: 1,
            name: 'Integrations',
            item: directory,
          },
          {
            '@type': 'ListItem',
            position: 2,
            name: connector.name,
            item: canonical,
          },
        ],
      },
      {
        '@type': 'FAQPage',
        '@id': `${canonical}#faq`,
        mainEntity: connector.faqs.map((faq) => ({
          '@type': 'Question',
          name: faq.question,
          acceptedAnswer: { '@type': 'Answer', text: faq.answer },
        })),
      },
    ],
  };
}

export function directoryStructuredData(siteUrl = getSiteUrl()) {
  const canonical = new URL('/integrations', siteUrl).toString();

  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'CollectionPage',
        '@id': `${canonical}#webpage`,
        url: canonical,
        name: 'Native integrations | The Timeline',
        description:
          'Explore native Timeline integrations for Slack, GitHub, Linear, Google Drive, Monday.com, and Sentry.',
        mainEntity: { '@id': `${canonical}#connectors` },
      },
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
