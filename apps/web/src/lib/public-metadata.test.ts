import { describe, expect, it } from 'vitest';

import { publicMetadata } from '@/lib/public-metadata';

describe('publicMetadata', () => {
  it('sets page-specific canonical, OpenGraph, and Twitter metadata', () => {
    const metadata = publicMetadata({
      title: 'Privacy Policy',
      description: 'Privacy details for The Timeline.',
      path: '/privacy',
    });

    expect(metadata).toMatchObject({
      title: 'Privacy Policy',
      description: 'Privacy details for The Timeline.',
      alternates: { canonical: '/privacy' },
      openGraph: {
        title: 'Privacy Policy',
        description: 'Privacy details for The Timeline.',
        url: '/privacy',
        type: 'website',
        siteName: 'The Timeline',
      },
      twitter: {
        card: 'summary_large_image',
        title: 'Privacy Policy',
        description: 'Privacy details for The Timeline.',
        images: ['/twitter-image'],
      },
    });
  });

  it('preserves page-level robots directives for redirect or noindex pages', () => {
    const metadata = publicMetadata({
      title: 'Contact',
      description: 'Contact The Timeline.',
      path: '/help/support',
      robots: { index: false, follow: true },
    });

    expect(metadata.robots).toEqual({ index: false, follow: true });
    expect(metadata.openGraph).toMatchObject({ title: 'Contact', url: '/help/support' });
  });
});
