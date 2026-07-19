import { redirect } from 'next/navigation';

import type { Metadata } from 'next';

import { AuthShell } from '@/components/auth-shell';
import { LegalAcceptanceForm } from '@/components/legal-acceptance-form';
import { auth } from '@/lib/auth';
import { getUserLegalAcceptance, hasCurrentLegalAcceptance } from '@/lib/legal';
import { safeSameOriginPath } from '@/lib/safe-redirect';

export const metadata: Metadata = {
  title: 'Legal acceptance',
  description: 'Accept the current Terms of Use and Privacy Policy before using The Timeline.',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

interface Props {
  searchParams: Promise<{ returnTo?: string }>;
}

export default async function LegalAcceptPage({ searchParams }: Props) {
  const [{ returnTo }, session] = await Promise.all([searchParams, auth()]);
  if (!session?.user) {
    redirect('/sign-in?callbackUrl=/legal/accept');
  }

  const legal = await getUserLegalAcceptance(session.user.id);
  const safeReturnTo = safeSameOriginPath(returnTo, '/app', {
    blockedPaths: ['/legal/accept', '/sign-in', '/sign-up'],
  });
  if (legal && hasCurrentLegalAcceptance(legal)) {
    redirect(safeReturnTo);
  }

  return (
    <AuthShell
      maxWidth="lg"
      title="Review The Timeline terms"
      subtitle="Before entering the signed-in product, accept the current Terms of Use and acknowledge the Privacy Policy."
    >
      <LegalAcceptanceForm returnTo={safeReturnTo} />
    </AuthShell>
  );
}
