import { buildInboundEmail } from '@timeline/shared/slug';
import { notFound } from 'next/navigation';

import type { Metadata } from 'next';

import { OnboardingPreviewGallery } from '@/app/dev/onboarding-preview/preview-gallery';

export const metadata: Metadata = {
  title: 'Onboarding UI preview',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default async function OnboardingPreviewPage(props: {
  searchParams: Promise<{ screen?: string }>;
}) {
  if (process.env.ONBOARDING_UI_PREVIEW !== '1') notFound();
  const { screen } = await props.searchParams;
  const inboundEmail = buildInboundEmail(
    'blank-workspace',
    process.env.INBOUND_EMAIL_DOMAIN ?? undefined,
  );
  return <OnboardingPreviewGallery screen={screen ?? 'welcome'} inboundEmail={inboundEmail} />;
}
