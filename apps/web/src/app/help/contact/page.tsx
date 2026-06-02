import { redirect } from 'next/navigation';

import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Contact',
  description: 'Contact the Timeline AI team for support.',
  alternates: { canonical: '/help/support' },
  robots: { index: false, follow: true },
};

export const dynamic = 'force-dynamic';

export default function ContactPage() {
  redirect('/help/support');
}
