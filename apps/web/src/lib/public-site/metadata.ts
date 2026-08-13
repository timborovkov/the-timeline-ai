import type { PublicDocument } from '@/lib/public-site/types';
import type { Metadata } from 'next';

import { publicMetadata } from '@/lib/public-metadata';

export function metadataForPublicDocument(document: PublicDocument): Metadata {
  return publicMetadata({
    title: document.title,
    description: document.description,
    path: document.canonicalPath,
    ...(document.indexability === 'noindex'
      ? { robots: { index: false, follow: document.capability.kind !== 'planned' } }
      : {}),
  });
}
