import { requirePlatformActor, PlatformAccessError } from '@timeline/shared/platform-admin';
import { notFound, redirect } from 'next/navigation';

import { realAuth } from '@/lib/auth';
import { db } from '@/lib/db';
import { getUserLegalAcceptance, hasCurrentLegalAcceptance } from '@/lib/legal';
import { isLegalPublicationReady } from '@/lib/legal-publication';

export async function requireAdmin() {
  const session = await realAuth();
  if (!session?.user) redirect('/sign-in');
  const actor = { userId: session.user.id, email: session.user.email ?? '' };
  try {
    await requirePlatformActor(db, actor);
  } catch (error) {
    if (error instanceof PlatformAccessError) notFound();
    throw error;
  }
  if (isLegalPublicationReady()) {
    const legal = await getUserLegalAcceptance(actor.userId);
    if (!legal || !hasCurrentLegalAcceptance(legal)) redirect('/legal/accept');
  }
  return actor;
}
