import { notFound } from 'next/navigation';

import type { Metadata } from 'next';

import { ComparePage } from '@/components/marketing/compare/compare-page';
import { COMPARE_TOOLS, findCompareTool } from '@/components/marketing/compare/content';
import { findComparePublicDocument } from '@/components/marketing/compare/public-documents';
import { metadataForPublicDocument } from '@/lib/public-site';

interface CompareRoutePageProps {
  params: Promise<{ slug: string }>;
}

export const dynamicParams = false;

export function generateStaticParams() {
  return COMPARE_TOOLS.map((tool) => ({ slug: tool.slug }));
}

export async function generateMetadata({ params }: CompareRoutePageProps): Promise<Metadata> {
  const { slug } = await params;
  const tool = findCompareTool(slug);
  if (!tool) return {};

  return metadataForPublicDocument(findComparePublicDocument(tool));
}

export default async function CompareToolRoutePage({ params }: CompareRoutePageProps) {
  const { slug } = await params;
  const tool = findCompareTool(slug);
  if (!tool) notFound();

  return <ComparePage tool={tool} />;
}
