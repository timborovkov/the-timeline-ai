import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'The Timeline',
    short_name: 'Timeline',
    description:
      'The operations log your team can talk to: capture work as it happens and query a cited team history.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#0a0e0d',
    theme_color: '#0a0e0d',
    icons: [
      {
        src: '/icon.svg',
        sizes: 'any',
        type: 'image/svg+xml',
        purpose: 'any',
      },
      {
        src: '/icon.svg',
        sizes: 'any',
        type: 'image/svg+xml',
        purpose: 'maskable',
      },
    ],
  };
}
