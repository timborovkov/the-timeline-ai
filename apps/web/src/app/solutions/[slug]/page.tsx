import { notFound, permanentRedirect } from 'next/navigation';

import type { Metadata } from 'next';

import { findSolution, SOLUTIONS } from '@/components/marketing/solutions/content';
import { createSolutionMetadata } from '@/components/marketing/solutions/metadata';
import { SolutionPage } from '@/components/marketing/solutions/solution-page';
import { USE_CASE_ROUTES } from '@/components/marketing/use-cases/content';

const SOLUTION_REDIRECTS = {
  'weekly-project-updates': USE_CASE_ROUTES.teamDailyLog,
  'crm-context-from-team-activity': USE_CASE_ROUTES.crm,
} as const;

interface SolutionRoutePageProps {
  params: Promise<{ slug: string }>;
}

export const dynamicParams = false;

export function generateStaticParams() {
  return [
    ...SOLUTIONS.map((solution) => ({ slug: solution.slug })),
    ...Object.keys(SOLUTION_REDIRECTS).map((slug) => ({ slug })),
  ];
}

export async function generateMetadata({ params }: SolutionRoutePageProps): Promise<Metadata> {
  const { slug } = await params;
  const solution = findSolution(slug);
  if (!solution) return {};

  return createSolutionMetadata(solution);
}

export default async function SolutionRoutePage({ params }: SolutionRoutePageProps) {
  const { slug } = await params;
  if (slug in SOLUTION_REDIRECTS) {
    permanentRedirect(SOLUTION_REDIRECTS[slug as keyof typeof SOLUTION_REDIRECTS]);
  }
  const solution = findSolution(slug);
  if (!solution) notFound();

  return <SolutionPage solution={solution} />;
}
