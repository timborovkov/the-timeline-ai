import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'The Timeline',
    short_name: 'Timeline',
    description:
      'The operations log your team can talk to: capture work as it happens and query a cited team history.',
    // Stable identity for existing installs; browsers fall back to start_url when id is absent.
    id: '/',
    start_url: '/app',
    scope: '/',
    display: 'standalone',
    background_color: '#0a0e0d',
    theme_color: '#0a0e0d',
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
