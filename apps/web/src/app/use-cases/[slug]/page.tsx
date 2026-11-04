import { notFound } from 'next/navigation';

import type { Metadata } from 'next';

import { findUseCase, USE_CASES } from '@/components/marketing/use-cases/content';
import { findUseCasePublicDocument } from '@/components/marketing/use-cases/public-documents';
import { UseCasePage } from '@/components/marketing/use-cases/use-case-page';
import { metadataForPublicDocument } from '@/lib/public-site';

interface UseCaseRoutePageProps {
  params: Promise<{ slug: string }>;
}

export const dynamicParams = false;

export function generateStaticParams() {
  return USE_CASES.map((useCase) => ({ slug: useCase.slug }));
}

export async function generateMetadata({ params }: UseCaseRoutePageProps): Promise<Metadata> {
  const { slug } = await params;
  const useCase = findUseCase(slug);
  if (!useCase) return {};

  return metadataForPublicDocument(findUseCasePublicDocument(useCase));
}

export default async function UseCaseRoutePage({ params }: UseCaseRoutePageProps) {
  const { slug } = await params;
  const useCase = findUseCase(slug);
  if (!useCase) notFound();

  return <UseCasePage useCase={useCase} />;
}
