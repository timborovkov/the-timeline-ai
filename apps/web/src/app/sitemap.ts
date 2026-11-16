import type { MetadataRoute } from 'next';

import { buildPublicSitemap, PUBLIC_DOCUMENT_REGISTRY } from '@/lib/public-site';
import { getSiteUrl } from '@/lib/site-url';

// Cache at build time; AUTH_URL must match the deployment origin.
// Previously force-dynamic avoided localhost URLs before the build origin was fixed.
export default function sitemap(): MetadataRoute.Sitemap {
  return buildPublicSitemap(PUBLIC_DOCUMENT_REGISTRY, getSiteUrl());
}
