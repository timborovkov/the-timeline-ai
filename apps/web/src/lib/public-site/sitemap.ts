import type { PublicDocumentRegistry } from '@/lib/public-site/types';
import type { MetadataRoute } from 'next';

import { canonicalPublicUrl } from '@/lib/public-site/registry';

export function buildPublicSitemap(
  registry: PublicDocumentRegistry,
  siteUrl: string,
): MetadataRoute.Sitemap {
  return registry.forSitemap().map((document) => {
    if (!document.sitemap) {
      throw new Error(`Sitemap document is missing sitemap settings: ${document.canonicalPath}`);
    }
    return {
      url: canonicalPublicUrl(siteUrl, document.canonicalPath),
      lastModified: document.dates.modified,
      changeFrequency: document.sitemap.changeFrequency,
      priority: document.sitemap.priority,
    };
  });
}
