import { expect } from '@timeline/test-support';
import { describe, it } from 'bun:test';

import { publicMetadata } from '@/lib/public-metadata';
import { PUBLIC_SOCIAL_CARDS } from '@/lib/public-social-cards';

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

  it('shares the current Free, Team, and Enterprise plans in the pricing image', () => {
    const metadata = publicMetadata({
      title: 'Pricing',
      description: 'Pricing for The Timeline.',
      path: '/pricing',
    });
    const image = { url: '/social/pricing' };

    expect(metadata.openGraph).toMatchObject({ images: [image] });
    expect(metadata.twitter).toMatchObject({ images: [image] });
    expect(PUBLIC_SOCIAL_CARDS.find((card) => card.id === 'pricing')).toMatchObject({
      steps: ['Free, no card required', 'Team seat / month', 'Custom Enterprise'],
      markers: ['$0', '$10', 'QUOTE'],
    });
  });
});
