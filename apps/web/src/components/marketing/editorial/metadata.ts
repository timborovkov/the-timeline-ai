import type { Metadata } from 'next';

import {
  EDITORIAL_GUIDES,
  EDITORIAL_PUBLICATION_NAME,
  RECORD_ROUTE,
  type EditorialGuide,
} from '@/components/marketing/editorial/content';
import { getSiteUrl } from '@/lib/site-url';

const SITE_NAME = 'The Timeline';
const SOCIAL_IMAGE = '/opengraph-image';

export function createRecordMetadata(): Metadata {
  const title = `${EDITORIAL_PUBLICATION_NAME}: field notes on operational memory`;
  const description =
    'Evidence-led essays, playbooks, dossiers, and product notes about turning scattered work into cited operational memory.';

  return createEditorialMetadata({ title, description, path: RECORD_ROUTE, type: 'website' });
}

export function createGuideMetadata(guide: EditorialGuide): Metadata {
  return createEditorialMetadata({
    title: guide.title,
    description: guide.summary,
    path: guide.route,
    type: 'article',
  });
}

function createEditorialMetadata(input: {
  title: string;
  description: string;
  path: string;
  type: 'website' | 'article';
}): Metadata {
  const openGraph: Metadata['openGraph'] = {
    title: input.title,
    description: input.description,
    type: input.type,
    siteName: SITE_NAME,
    url: input.path,
    images: [
      {
        url: SOCIAL_IMAGE,
        width: 1200,
        height: 630,
        alt: `${input.title} by ${SITE_NAME}`,
      },
    ],
  };

  return {
    title: input.title,
    description: input.description,
    alternates: { canonical: input.path },
    openGraph,
    twitter: {
      card: 'summary_large_image',
      title: input.title,
      description: input.description,
      images: [SOCIAL_IMAGE],
    },
    robots: {
      index: true,
      follow: true,
      googleBot: { index: true, follow: true, 'max-snippet': -1 },
    },
  };
}

export function buildRecordStructuredData(): Record<string, unknown> {
  const siteUrl = getSiteUrl();
  const recordUrl = absoluteUrl(RECORD_ROUTE, siteUrl);

  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'CollectionPage',
        '@id': `${recordUrl}#publication`,
        url: recordUrl,
        name: EDITORIAL_PUBLICATION_NAME,
        description:
          'Evidence-led essays, playbooks, dossiers, and product notes about operational memory.',
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
          articleSection: guide.typeLabel,
        })),
      },
      breadcrumbList(siteUrl, [
        { name: 'Home', path: '/' },
        { name: EDITORIAL_PUBLICATION_NAME, path: RECORD_ROUTE },
      ]),
    ],
  };
}

export function buildGuideStructuredData(guide: EditorialGuide): Record<string, unknown> {
  const siteUrl = getSiteUrl();
  const guideUrl = absoluteUrl(guide.route, siteUrl);

  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Article',
        '@id': `${guideUrl}#article`,
        url: guideUrl,
        mainEntityOfPage: guideUrl,
        headline: guide.title,
        description: guide.machineSummary,
        articleSection: guide.typeLabel,
        author: organization(siteUrl),
        publisher: organization(siteUrl),
        isPartOf: {
          '@type': 'CollectionPage',
          '@id': `${absoluteUrl(RECORD_ROUTE, siteUrl)}#publication`,
          name: EDITORIAL_PUBLICATION_NAME,
        },
        about: guide.topics.map((topic) => ({ '@type': 'Thing', name: topic })),
        mentions: guide.nativeConnectors.map((connector) => ({
          '@type': 'SoftwareApplication',
          name: connector,
        })),
      },
      breadcrumbList(siteUrl, [
        { name: 'Home', path: '/' },
        { name: EDITORIAL_PUBLICATION_NAME, path: RECORD_ROUTE },
        { name: guide.shortTitle, path: guide.route },
      ]),
    ],
  };
}

function organization(siteUrl: string) {
  return {
    '@type': 'Organization',
    '@id': `${siteUrl}/#organization`,
    name: SITE_NAME,
    url: siteUrl,
  };
}

function breadcrumbList(
  siteUrl: string,
  items: readonly { name: string; path: string }[],
): Record<string, unknown> {
  return {
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: absoluteUrl(item.path, siteUrl),
    })),
  };
}

function absoluteUrl(path: string, siteUrl: string): string {
  return new URL(path, `${siteUrl}/`).toString();
}
