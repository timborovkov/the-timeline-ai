import { notFound } from 'next/navigation';

import type { Metadata } from 'next';

import { findSolution, SOLUTIONS } from '@/components/marketing/solutions/content';
import { createSolutionMetadata } from '@/components/marketing/solutions/metadata';
import { SolutionPage } from '@/components/marketing/solutions/solution-page';

interface SolutionRoutePageProps {
  params: Promise<{ slug: string }>;
}

export const dynamicParams = false;

export function generateStaticParams() {
  return SOLUTIONS.map((solution) => ({ slug: solution.slug }));
}

export async function generateMetadata({ params }: SolutionRoutePageProps): Promise<Metadata> {
  const { slug } = await params;
  const solution = findSolution(slug);
  if (!solution) return {};

  return createSolutionMetadata(solution);
}

export default async function SolutionRoutePage({ params }: SolutionRoutePageProps) {
  const { slug } = await params;
  const solution = findSolution(slug);
  if (!solution) notFound();

  return <SolutionPage solution={solution} />;
}
