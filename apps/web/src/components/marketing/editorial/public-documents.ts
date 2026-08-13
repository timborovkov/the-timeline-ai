import type { PublicDocument } from '@/lib/public-site/types';

import {
  EDITORIAL_CONTENT_TYPES,
  EDITORIAL_GUIDES,
  EDITORIAL_PUBLICATION_NAME,
  RECORD_ROUTE,
  type GuideRoute,
} from '@/components/marketing/editorial/content';
import { definePublicDocuments } from '@/lib/public-site/registry';

const EDITORIAL_REVIEW_DATE = '2026-08-13' as const;

const recordDocument = {
  canonicalPath: RECORD_ROUTE,
  kind: 'record',
  title: `${EDITORIAL_PUBLICATION_NAME}: field notes on operational memory`,
  description:
    'Practical playbooks and evidence-led dossiers about turning scattered work into cited operational memory.',
  indexability: 'index',
  dates: { modified: EDITORIAL_REVIEW_DATE, reviewed: EDITORIAL_REVIEW_DATE },
  capability: { kind: 'current-product' },
  sitemap: { changeFrequency: 'weekly', priority: 0.8 },
  structuredData: [
    { type: 'collection-page' },
    {
      type: 'breadcrumbs',
      items: [
        { name: 'Home', path: '/' },
        { name: EDITORIAL_PUBLICATION_NAME, path: RECORD_ROUTE },
      ],
    },
  ],
  llms: {
    section: 'the-record',
    order: 0,
    label: EDITORIAL_PUBLICATION_NAME,
    summary:
      'Practical playbooks and evidence-led dossiers about turning scattered work into cited operational memory.',
    sections: [
      {
        title: 'Published formats',
        body: 'The current edition contains two formats, each with a distinct editorial purpose.',
        items: EDITORIAL_CONTENT_TYPES.map((type) => `${type.label}: ${type.description}`),
      },
      {
        title: 'Editorial method',
        body: 'Every guide leads with a direct answer, then exposes the workflow, provenance map, source boundaries, limitations, and query contract behind it.',
      },
    ],
  },
} satisfies PublicDocument;

const guideDocuments = EDITORIAL_GUIDES.map(
  (guide, index): PublicDocument => ({
    canonicalPath: guide.route,
    kind: 'guide',
    title: guide.title,
    description: guide.summary,
    indexability: 'index',
    dates: { modified: EDITORIAL_REVIEW_DATE, reviewed: EDITORIAL_REVIEW_DATE },
    capability: { kind: 'current-product' },
    sitemap: { changeFrequency: 'monthly', priority: 0.7 },
    structuredData: [
      { type: 'tech-article' },
      {
        type: 'breadcrumbs',
        items: [
          { name: 'Home', path: '/' },
          { name: EDITORIAL_PUBLICATION_NAME, path: RECORD_ROUTE },
          { name: guide.shortTitle, path: guide.route },
        ],
      },
      { type: 'faq', entries: guide.faqs },
    ],
    llms: {
      section: 'the-record',
      order: (index + 1) * 10,
      summary: guide.machineSummary,
      sections: [
        {
          title: 'Direct answer',
          body: guide.answer.body,
          items: guide.answer.checklist,
        },
        {
          title: 'Workflow',
          body: 'Build the answer in inspectable stages and retain each stage as part of the review path.',
          items: guide.workflow.map(
            (step) => `${step.index} — ${step.title}: ${step.body} Output: ${step.output}`,
          ),
        },
        {
          title: 'Source boundaries',
          body: 'Each provider contributes a distinct kind of evidence and keeps an explicit capability boundary.',
          items: guide.boundaries.map(
            (boundary) =>
              `${boundary.provider} — ${boundary.role}. Includes: ${boundary.includes} Boundary: ${boundary.boundary}`,
          ),
        },
        {
          title: 'Limitations',
          body: 'These limitations remain visible when interpreting or sharing the answer.',
          items: guide.limitations,
        },
      ],
    },
  }),
);

export const EDITORIAL_PUBLIC_DOCUMENTS = definePublicDocuments('editorial-record', [
  recordDocument,
  ...guideDocuments,
]);

export function findEditorialPublicDocument(
  route: typeof RECORD_ROUTE | GuideRoute,
): PublicDocument {
  const document = EDITORIAL_PUBLIC_DOCUMENTS.documents.find(
    (candidate) => candidate.canonicalPath === route,
  );
  if (!document) throw new Error(`Editorial public document not found for route: ${route}`);
  return document;
}
