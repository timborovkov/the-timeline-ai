import type { Metadata } from 'next';

import {
  EDITORIAL_GUIDES,
  EDITORIAL_PUBLICATION_NAME,
  RECORD_ROUTE,
  type EditorialGuide,
} from '@/components/marketing/editorial/content';
import { findEditorialPublicDocument } from '@/components/marketing/editorial/public-documents';
import { metadataForPublicDocument } from '@/lib/public-site/metadata';
import {
  buildPublicStructuredData,
  type PublicStructuredDataGraph,
} from '@/lib/public-site/structured-data';
import { getSiteUrl } from '@/lib/site-url';

const SITE_NAME = 'The Timeline';

export function createRecordMetadata(): Metadata {
  return createEditorialMetadata(findEditorialPublicDocument(RECORD_ROUTE), 'website');
}

export function createGuideMetadata(guide: EditorialGuide): Metadata {
  return createEditorialMetadata(findEditorialPublicDocument(guide.route), 'article');
}

function createEditorialMetadata(
  document: ReturnType<typeof findEditorialPublicDocument>,
  type: 'website' | 'article',
): Metadata {
  const metadata = metadataForPublicDocument(document);
  return {
    ...metadata,
    openGraph: { ...metadata.openGraph, type },
    robots: {
      index: document.indexability === 'index',
      follow: document.indexability === 'index',
      googleBot: {
        index: document.indexability === 'index',
        follow: document.indexability === 'index',
        'max-snippet': -1,
      },
    },
  };
}

export function buildRecordStructuredData(): PublicStructuredDataGraph {
  const siteUrl = getSiteUrl();
  const data = buildPublicStructuredData(findEditorialPublicDocument(RECORD_ROUTE), siteUrl);
  const collection = data['@graph'].find((node) => node['@type'] === 'CollectionPage');

  if (collection) {
    Object.assign(collection, {
      name: EDITORIAL_PUBLICATION_NAME,
      isPartOf: {
        '@type': 'WebSite',
        '@id': `${siteUrl}/#website`,
        name: SITE_NAME,
      },
      publisher: organization(siteUrl),
      hasPart: EDITORIAL_GUIDES.map((guide) => ({
        '@type': 'Article',
        url: absoluteUrl(guide.route, siteUrl),
        headline: guide.title,
        description: guide.machineSummary,
        articleSection: EDITORIAL_PUBLICATION_NAME,
      })),
    });
  }

  return data;
}

export function buildGuideStructuredData(guide: EditorialGuide): PublicStructuredDataGraph {
  const siteUrl = getSiteUrl();
  const guideUrl = absoluteUrl(guide.route, siteUrl);
  const data = buildPublicStructuredData(findEditorialPublicDocument(guide.route), siteUrl);
  const article = data['@graph'].find((node) => node['@type'] === 'TechArticle');

  if (article) {
    Object.assign(article, {
      mainEntityOfPage: guideUrl,
      headline: guide.title,
      articleSection: EDITORIAL_PUBLICATION_NAME,
      author: organization(siteUrl),
      publisher: organization(siteUrl),
      isPartOf: {
        '@type': 'CollectionPage',
        '@id': `${absoluteUrl(RECORD_ROUTE, siteUrl)}#webpage`,
        name: EDITORIAL_PUBLICATION_NAME,
      },
      about: guide.topics.map((topic) => ({ '@type': 'Thing', name: topic })),
      mentions: guide.nativeConnectors.map((connector) => ({
        '@type': 'SoftwareApplication',
        name: connector,
      })),
    });
  }

  return data;
}

function organization(siteUrl: string) {
  return {
    '@type': 'Organization',
    '@id': `${siteUrl}/#organization`,
    name: SITE_NAME,
    url: siteUrl,
  };
}

function absoluteUrl(path: string, siteUrl: string): string {
  return new URL(path, `${siteUrl}/`).toString();
}
