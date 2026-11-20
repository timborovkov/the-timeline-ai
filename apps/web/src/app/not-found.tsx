import type { Metadata } from 'next';

import { RootNotFoundContent } from '@/app/_root-not-found-content';
import { PublicShell } from '@/components/public-shell';

export const metadata: Metadata = {
  title: 'Page not found',
  description: 'This page could not be found.',
};

export default function NotFound() {
  return (
    <PublicShell footerLabel="The Timeline">
      <RootNotFoundContent />
    </PublicShell>
  );
}
