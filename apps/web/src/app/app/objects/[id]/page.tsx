import { withTeam } from '@timeline/shared';
import { notFound, redirect } from 'next/navigation';

import type { Metadata } from 'next';

import { ObjectDetailClient } from '@/components/objects/object-detail-client';
import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { serializeSuggestionBundle } from '@/lib/suggestions';

export const metadata: Metadata = {
  title: 'Object',
  description: 'Review an object timeline and related suggestions.',
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function ObjectDetailPage({ params }: PageProps) {
  const session = await auth();
  if (!session?.user) redirect('/sign-in');
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) redirect('/sign-in');

  const { id } = await params;
  // `getObject` accepts either a UUID or a canonical name (used by agent
  // tools), but at this route the `[id]` segment is contractually a UUID.
  // Validate up front so `/app/objects/not-a-uuid` returns a clean 404
  // instead of accidentally resolving to an entity whose name happens to
  // match the URL segment.
  if (!UUID_RE.test(id)) notFound();
  const scope = withTeam(db, active.teamId, session.user.id);
  // ORDER MATTERS: getObject reads the previous `lastVisitedAt` to
  // compute `newSinceLastVisit` for the banner. markVisited is called
  // AFTER so the banner reflects "changes since the previous visit."
  // Moving markVisited above getObject would zero the banner forever
  // after the first load.
  const detail = await scope.objects.getObject(id);
  if (!detail) notFound();

  await scope.objects.markVisited(detail.id);
  const suggestions = (await scope.suggestions.listPendingSuggestions()).flatMap((bundle) => {
    const items = bundle.items.filter((item) => item.targetId === detail.id);
    return items.length > 0 ? [serializeSuggestionBundle({ ...bundle, items })] : [];
  });

  return (
    <div className="mx-auto max-w-4xl">
      <ObjectDetailClient detail={detail} userId={session.user.id} suggestions={suggestions} />
    </div>
  );
}
