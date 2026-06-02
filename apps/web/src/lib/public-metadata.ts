import type { Metadata } from 'next';

const SITE_NAME = 'The Timeline';
const OG_IMAGE = {
  url: '/opengraph-image',
  width: 1200,
  height: 630,
  alt: 'The Timeline — the operations log your team can talk to',
};

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
      images: [OG_IMAGE],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: ['/twitter-image'],
    },
    ...(robots ? { robots } : {}),
  };
}
