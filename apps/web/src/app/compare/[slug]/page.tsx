import { notFound, permanentRedirect } from 'next/navigation';

import type { Metadata } from 'next';

import { ComparePage } from '@/components/marketing/compare/compare-page';
import {
  COMPARE_PAGES,
  LEGACY_COMPARE_REDIRECTS,
  findComparePage,
  isLegacyCompareSlug,
} from '@/components/marketing/compare/content';
import { findComparePublicDocument } from '@/components/marketing/compare/public-documents';
import { metadataForPublicDocument } from '@/lib/public-site';

interface CompareRoutePageProps {
  params: Promise<{ slug: string }>;
}

export const dynamicParams = false;

export function generateStaticParams() {
  return [
    ...COMPARE_PAGES.map((page) => ({ slug: page.slug })),
    ...Object.keys(LEGACY_COMPARE_REDIRECTS).map((slug) => ({ slug })),
  ];
}

export async function generateMetadata({ params }: CompareRoutePageProps): Promise<Metadata> {
  const { slug } = await params;
  if (isLegacyCompareSlug(slug)) return {};
  const page = findComparePage(slug);
  if (!page) return {};

  return metadataForPublicDocument(findComparePublicDocument(page));
}

export default async function CompareToolRoutePage({ params }: CompareRoutePageProps) {
  const { slug } = await params;
  if (isLegacyCompareSlug(slug)) {
    permanentRedirect(LEGACY_COMPARE_REDIRECTS[slug]);
  }
  const page = findComparePage(slug);
  if (!page) notFound();

  return <ComparePage page={page} />;
}
