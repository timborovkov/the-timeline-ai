import type { Metadata } from 'next';

import { PRODUCT_POSITIONING } from '@/lib/product-positioning';
import { PUBLIC_SOCIAL_CARDS } from '@/lib/public-social-cards';

const SITE_NAME = 'The Timeline';
const DEFAULT_IMAGE = {
  url: '/opengraph-image',
  width: 1200,
  height: 630,
  alt: PRODUCT_POSITIONING.socialAlt,
};
const PUBLIC_PREVIEW_ROBOTS = {
  googleBot: {
    'max-video-preview': -1,
    'max-image-preview': 'large',
    'max-snippet': -1,
  },
} satisfies Metadata['robots'];

interface PublicMetadataInput {
  title: string;
  description: string;
  path: string;
  robots?: Metadata['robots'];
}

export function publicMetadata({
  title,
  description,
  path,
  robots,
}: PublicMetadataInput): Metadata {
  const socialCard = PUBLIC_SOCIAL_CARDS.find((card) => card.path === path);
  const image = socialCard
    ? { ...DEFAULT_IMAGE, url: `/social/${socialCard.id}`, alt: socialCard.alt }
    : DEFAULT_IMAGE;
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: {
      title,
      description,
      type: 'website',
      siteName: SITE_NAME,
      url: path,
      images: [image],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: socialCard ? [image] : ['/twitter-image'],
    },
    robots: robots ?? PUBLIC_PREVIEW_ROBOTS,
  };
}
