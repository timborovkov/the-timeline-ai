import type { SolutionContent } from '@/components/marketing/solutions/content';
import type { Metadata } from 'next';

import { findSolutionPublicDocument } from '@/components/marketing/solutions/public-documents';
import { metadataForPublicDocument } from '@/lib/public-site/metadata';
import {
  buildPublicStructuredData,
  type PublicStructuredDataGraph,
} from '@/lib/public-site/structured-data';
import { getSiteUrl } from '@/lib/site-url';

export function createSolutionMetadata(solution: SolutionContent): Metadata {
  const document = findSolutionPublicDocument(solution);
  const metadata = metadataForPublicDocument(document);
  return {
    ...metadata,
    openGraph: { ...metadata.openGraph, type: 'website' },
  };
}

export function buildSolutionStructuredData(solution: SolutionContent): PublicStructuredDataGraph {
  return buildPublicStructuredData(findSolutionPublicDocument(solution), getSiteUrl());
}
