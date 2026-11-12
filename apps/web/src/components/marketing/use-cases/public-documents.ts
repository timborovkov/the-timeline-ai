import type { PublicDocument, PublicLlmsContentSection } from '@/lib/public-site';

import { PRODUCT_TOUR } from '@/components/marketing/product-tour/content';
import {
  USE_CASE_HUB,
  USE_CASES,
  type UseCaseContent,
} from '@/components/marketing/use-cases/content';
import { definePublicDocuments } from '@/lib/public-site/registry';

const REVIEW_DATE = '2026-11-07' as const;
const PRODUCT_TOUR_REVIEW_DATE = '2026-11-12' as const;

function useCaseLlmsSections(useCase: UseCaseContent): readonly PublicLlmsContentSection[] {
  return [
    {
      title: 'Direct answer',
      body: `${useCase.title} ${useCase.summary}`,
    },
    ...(useCase.howItWorks ? [{ title: 'How it works', body: useCase.howItWorks.join(' ') }] : []),
    {
      title: 'Example',
      body: useCase.example.title ?? useCase.example.label,
      items: [...useCase.example.lines],
    },
    ...(useCase.needs ? [{ title: 'What it needs', body: useCase.needs }] : []),
    ...(useCase.boundary ? [{ title: 'Boundary', body: useCase.boundary }] : []),
    {
      title: 'Questions',
      body: 'Current product boundaries for this use case.',
      items: useCase.faqs.map((faq) => `${faq.question} ${faq.answer}`),
    },
  ];
}

export const USE_CASE_PUBLIC_DOCUMENTS = definePublicDocuments('use-cases', [
  {
    canonicalPath: USE_CASE_HUB.route,
    kind: 'guide-index',
    title: USE_CASE_HUB.seoTitle,
    description: USE_CASE_HUB.seoDescription,
    indexability: 'index',
    dates: { modified: '2026-11-12', reviewed: '2026-11-12' },
    capability: { kind: 'current-product' },
    sitemap: { changeFrequency: 'weekly', priority: 0.9 },
    structuredData: [
      { type: 'collection-page' },
      {
        type: 'breadcrumbs',
        items: [
          { name: 'Home', path: '/' },
          { name: 'Use cases', path: USE_CASE_HUB.route },
        ],
      },
    ],
    llms: {
      section: 'use-cases',
      order: 0,
      label: 'Use cases',
      summary: USE_CASE_HUB.seoDescription,
      fullSummary: USE_CASE_HUB.summary,
      sections: [
        {
          title: 'Six jobs from one record',
          body: USE_CASE_HUB.summary,
          items: USE_CASES.map((useCase) => `${useCase.cardTitle}: ${useCase.cardBody}`),
          links: USE_CASES.map((useCase) => ({
            label: useCase.navLabel,
            href: useCase.route,
          })),
        },
      ],
    },
  },
  ...USE_CASES.map((useCase, index): PublicDocument => ({
    canonicalPath: useCase.route,
    kind: 'solution',
    title: useCase.seoTitle,
    description: useCase.seoDescription,
    indexability: 'index',
    dates: {
      modified: useCase.route === '/use-cases/work-record' ? '2026-11-12' : REVIEW_DATE,
      reviewed: useCase.route === '/use-cases/work-record' ? '2026-11-12' : REVIEW_DATE,
    },
    capability: { kind: 'current-product' },
    sitemap: { changeFrequency: 'monthly', priority: 0.8 },
    structuredData: [
      { type: 'web-page' },
      {
        type: 'breadcrumbs',
        items: [
          { name: 'Home', path: '/' },
          { name: 'Use cases', path: USE_CASE_HUB.route },
          { name: useCase.navLabel, path: useCase.route },
        ],
      },
      { type: 'faq', entries: useCase.faqs },
      {
        type: 'software-application',
        name: 'The Timeline',
        applicationCategory: 'BusinessApplication',
        operatingSystem: 'Web',
        features: [useCase.cardBody, useCase.summary],
      },
    ],
    llms: {
      section: 'use-cases',
      order: (index + 1) * 10,
      label: useCase.navLabel,
      summary: useCase.seoDescription,
      fullSummary: useCase.summary,
      sections: useCaseLlmsSections(useCase),
    },
  })),
]);

export const PRODUCT_TOUR_DOCUMENT = {
  canonicalPath: PRODUCT_TOUR.route,
  kind: 'product',
  title: PRODUCT_TOUR.seoTitle,
  description: PRODUCT_TOUR.seoDescription,
  indexability: 'index',
  dates: { modified: PRODUCT_TOUR_REVIEW_DATE, reviewed: PRODUCT_TOUR_REVIEW_DATE },
  capability: { kind: 'current-product' },
  sitemap: { changeFrequency: 'monthly', priority: 0.8 },
  structuredData: [
    { type: 'web-page' },
    {
      type: 'breadcrumbs',
      items: [
        { name: 'Home', path: '/' },
        { name: 'Product tour', path: PRODUCT_TOUR.route },
      ],
    },
  ],
  llms: {
    section: 'primary',
    order: 12,
    label: 'Product tour',
    summary: `${PRODUCT_TOUR.title} ${PRODUCT_TOUR.seoDescription}`,
    fullSummary: PRODUCT_TOUR.summary,
    sections: PRODUCT_TOUR.steps.map((step) => ({
      title: `${step.index} ${step.headline}`,
      body: step.caption,
    })),
  },
} as const satisfies PublicDocument;

export function findUseCasePublicDocument(useCase: Pick<UseCaseContent, 'route'>): PublicDocument {
  const document = USE_CASE_PUBLIC_DOCUMENTS.documents.find(
    (candidate) => candidate.canonicalPath === useCase.route,
  );
  if (!document) throw new Error(`Missing public document for use case ${useCase.route}`);
  return document;
}
