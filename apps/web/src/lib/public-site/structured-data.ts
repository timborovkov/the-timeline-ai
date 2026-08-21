import type { PublicDocument, PublicStructuredDataInput } from '@/lib/public-site/types';

import { canonicalPublicUrl } from '@/lib/public-site/registry';

type JsonLdNode = Record<string, unknown>;

export interface PublicStructuredDataGraph {
  '@context': 'https://schema.org';
  '@graph': JsonLdNode[];
}

export function buildPublicStructuredData(
  document: PublicDocument,
  siteUrl: string,
): PublicStructuredDataGraph {
  const canonicalUrl = canonicalPublicUrl(siteUrl, document.canonicalPath);
  return {
    '@context': 'https://schema.org',
    '@graph': document.structuredData.map((input) =>
      structuredDataNode(input, document, siteUrl, canonicalUrl),
    ),
  };
}

export function stringifyJsonLdForHtml(value: unknown): string {
  return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, (character) => {
    switch (character) {
      case '<':
        return '\\u003c';
      case '>':
        return '\\u003e';
      case '&':
        return '\\u0026';
      case '\u2028':
        return '\\u2028';
      case '\u2029':
        return '\\u2029';
      default:
        return character;
    }
  });
}

function structuredDataNode(
  input: PublicStructuredDataInput,
  document: PublicDocument,
  siteUrl: string,
  canonicalUrl: string,
): JsonLdNode {
  switch (input.type) {
    case 'web-page':
    case 'collection-page':
      return pageNode(
        input.type === 'web-page' ? 'WebPage' : 'CollectionPage',
        document,
        canonicalUrl,
      );
    case 'tech-article':
      return {
        ...pageNode('TechArticle', document, canonicalUrl),
        ...(input.published ? { datePublished: input.published } : {}),
        ...(input.authorName ? { author: { '@type': 'Person', name: input.authorName } } : {}),
      };
    case 'breadcrumbs':
      return {
        '@type': 'BreadcrumbList',
        itemListElement: input.items.map((item, index) => ({
          '@type': 'ListItem',
          position: index + 1,
          name: item.name,
          item: canonicalPublicUrl(siteUrl, item.path),
        })),
      };
    case 'faq':
      return {
        '@type': 'FAQPage',
        mainEntity: input.entries.map((entry) => ({
          '@type': 'Question',
          name: entry.question,
          acceptedAnswer: { '@type': 'Answer', text: entry.answer },
        })),
      };
    case 'software-application':
      return {
        '@type': 'SoftwareApplication',
        name: input.name,
        description: document.description,
        url: canonicalUrl,
        applicationCategory: input.applicationCategory,
        operatingSystem: input.operatingSystem,
        ...(input.features ? { featureList: input.features } : {}),
      };
  }
}

function pageNode(
  type: 'WebPage' | 'CollectionPage' | 'TechArticle',
  document: PublicDocument,
  canonicalUrl: string,
): JsonLdNode {
  return {
    '@type': type,
    '@id': `${canonicalUrl}#webpage`,
    url: canonicalUrl,
    name: document.title,
    description: document.description,
    dateModified: document.dates.modified,
    lastReviewed: document.dates.reviewed,
  };
}
