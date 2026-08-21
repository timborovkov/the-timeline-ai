import type { PublicDocument, PublicLlmsContentSection } from '@/lib/public-site';

import { SOLUTIONS, type SolutionContent } from '@/components/marketing/solutions/content';
import { definePublicDocuments } from '@/lib/public-site/registry';

const SOLUTION_REVIEW_DATE = '2026-08-21' as const;

export const SOLUTION_PUBLIC_DOCUMENTS = definePublicDocuments(
  'solutions',
  SOLUTIONS.map(
    (solution, index): PublicDocument => ({
      canonicalPath: solution.route,
      kind: 'solution',
      title: solution.seoTitle,
      description: solution.seoDescription,
      indexability: 'index',
      dates: { modified: SOLUTION_REVIEW_DATE, reviewed: SOLUTION_REVIEW_DATE },
      capability: { kind: 'current-product' },
      sitemap: { changeFrequency: 'monthly', priority: 0.8 },
      structuredData: [
        { type: 'web-page' },
        {
          type: 'breadcrumbs',
          items: [
            { name: 'The Timeline', path: '/' },
            { name: solution.shortTitle, path: solution.route },
          ],
        },
        { type: 'faq', entries: solution.faqs },
        {
          type: 'software-application',
          name: 'The Timeline',
          applicationCategory: 'BusinessApplication',
          operatingSystem: 'Web',
          features: solution.answer.checklist,
        },
      ],
      llms: {
        section: 'solutions',
        order: (index + 1) * 10,
        label: solution.shortTitle,
        summary: solution.seoDescription,
        fullSummary: solution.summary,
        sections: solutionLlmsSections(solution),
      },
    }),
  ),
);

function solutionLlmsSections(solution: SolutionContent): readonly PublicLlmsContentSection[] {
  return [
    {
      title: 'Direct answer',
      body: `${solution.answer.title} ${solution.answer.body}`,
      items: solution.answer.checklist,
    },
    {
      title: 'Workflow',
      body: 'Use an explicit evidence boundary, preserve chronology, ask a bounded question, and review the cited result.',
      items: solution.workflow.map((step) => `${step.title}: ${step.body} Output: ${step.output}`),
    },
    {
      title: 'Evidence roles and boundaries',
      body: 'Each source keeps a distinct role. Connection or capture does not make every record available or every claim true.',
      items: solution.evidenceRoles.map(
        (source) =>
          `${source.label} — ${source.role}. Includes: ${source.includes} Boundary: ${source.boundary}`,
      ),
    },
    {
      title: 'Questions this solution can answer',
      body: 'Start with a named project, account, or reporting window and request citations for factual claims.',
      items: solution.questions,
    },
    {
      title: 'Illustrative answer',
      body: `${solution.example.title} ${solution.example.body}`,
      items: [...solution.example.claims, solution.example.note],
    },
    {
      title: 'Current limitations',
      body: 'These boundaries prevent a cited answer from being mistaken for complete or automatically authoritative truth.',
      items: solution.limitations,
    },
  ];
}

export function findSolutionPublicDocument(
  solution: Pick<SolutionContent, 'route'>,
): PublicDocument {
  const document = SOLUTION_PUBLIC_DOCUMENTS.documents.find(
    (candidate) => candidate.canonicalPath === solution.route,
  );
  if (!document) throw new Error(`Missing public document for solution ${solution.route}`);
  return document;
}
