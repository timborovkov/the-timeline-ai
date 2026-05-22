import { objects, withTeam } from '@timeline/shared';
import { notFound, redirect } from 'next/navigation';

import { ObjectDetailClient } from '@/components/objects/object-detail-client';
import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function ObjectDetailPage({ params }: PageProps) {
  const session = await auth();
  if (!session?.user) redirect('/sign-in');
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) redirect('/sign-in');

  const { id } = await params;
  const scope = withTeam(db, active.teamId, session.user.id);
  // ORDER MATTERS: getObject reads the previous `lastVisitedAt` to compute
  // `newSinceLastVisit` for the banner. markVisited is called AFTER so the
  // banner reflects "changes since the previous visit." Moving markVisited
  // above getObject would zero the banner forever after the first load.
  const detail = await objects.getObject(db, scope, id);
  if (!detail) notFound();

  await objects.markVisited(db, scope, detail.id);

  return <ObjectDetailClient detail={detail} userId={session.user.id} />;
}
