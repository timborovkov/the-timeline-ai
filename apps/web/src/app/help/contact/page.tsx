import { redirect } from 'next/navigation';

import type { Metadata } from 'next';

import { publicMetadata } from '@/lib/public-metadata';

export const metadata: Metadata = publicMetadata({
  title: 'Contact',
  description: 'Contact the Timeline AI team for support.',
  path: '/help/support',
  robots: { index: false, follow: true },
});

export const dynamic = 'force-dynamic';

export default function ContactPage() {
  redirect('/help/support');
}
