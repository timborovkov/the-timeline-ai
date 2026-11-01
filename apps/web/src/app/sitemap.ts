import type { MetadataRoute } from 'next';

import { buildPublicSitemap, PUBLIC_DOCUMENT_REGISTRY } from '@/lib/public-site';
import { getSiteUrl } from '@/lib/site-url';

export const dynamic = 'force-dynamic';

export default function sitemap(): MetadataRoute.Sitemap {
  return buildPublicSitemap(PUBLIC_DOCUMENT_REGISTRY, getSiteUrl());
}
