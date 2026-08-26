import type { MetadataRoute } from 'next';

import { PWA_BACKGROUND_COLOR } from '@/lib/pwa-splash';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'The Timeline',
    short_name: 'Timeline',
    description:
      'AI team memory that turns selected work into a searchable project history with cited answers.',
    // Stable identity for existing installs; browsers fall back to start_url when id is absent.
    id: '/',
    start_url: '/app',
    scope: '/',
    display: 'standalone',
    background_color: PWA_BACKGROUND_COLOR,
    theme_color: PWA_BACKGROUND_COLOR,
    icons: [
      {
        src: '/icons/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/icon-512-maskable.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
      {
        src: '/icon.svg',
        sizes: 'any',
        type: 'image/svg+xml',
        purpose: 'any',
      },
    ],
  };
}
