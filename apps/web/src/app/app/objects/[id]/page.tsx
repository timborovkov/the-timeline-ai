import { withTeam } from '@timeline/shared/team-scope';
import { notFound, redirect } from 'next/navigation';

import type { SuggestionBundle } from '@timeline/shared/suggestions';
import type { Metadata } from 'next';

import { suggestionTargetsObject } from '@/app/app/objects/[id]/suggestion-targets';
import { HistoryBackLink } from '@/components/history-back-link';
import { ObjectBoardContext } from '@/components/objects/object-board-context';
import { ObjectDetailClient } from '@/components/objects/object-detail-client';
import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { safeSameOriginPath } from '@/lib/safe-redirect';
import { isActionableSuggestionStatus } from '@/lib/suggestion-status';
import { serializeSuggestionBundle } from '@/lib/suggestions';

export const metadata: Metadata = {
  title: 'Object',
  description: 'Review an object timeline and related suggestions.',
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type PageSearchParams = Record<string, string | string[] | undefined>;

const EMPTY_SEARCH_PARAMS: PageSearchParams = {};

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams?: Promise<PageSearchParams>;
}

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function objectPageSuggestionItems(
  bundle: SuggestionBundle,
  objectId: string,
  boardItemIds: ReadonlySet<string>,
): SuggestionBundle['items'] {
  const includedIds = new Set<string>();
  const localRefs = new Set<string>();
  for (const item of bundle.items) {
    if (
      isActionableSuggestionStatus(item.status) &&
      suggestionTargetsObject(item, objectId, { boardItemIds, siblingItems: bundle.items })
    ) {
      includedIds.add(item.id);
      if (item.targetKind === 'object_relationship') {
        if (typeof item.proposedPayload.fromRef === 'string') {
          localRefs.add(item.proposedPayload.fromRef.toLowerCase());
        }
        if (typeof item.proposedPayload.toRef === 'string') {
          localRefs.add(item.proposedPayload.toRef.toLowerCase());
        }
      }
    }
  }
  if (localRefs.size > 0) {
    for (const item of bundle.items) {
      if (!isActionableSuggestionStatus(item.status)) continue;
      const ref =
        typeof item.proposedPayload.localRef === 'string'
          ? item.proposedPayload.localRef.toLowerCase()
          : null;
      if (ref && localRefs.has(ref)) includedIds.add(item.id);
    }
  }
  return bundle.items.filter((item) => includedIds.has(item.id));
}

export default async function ObjectDetailPage({ params, searchParams }: PageProps) {
  const [session, query] = await Promise.all([
    auth(),
    searchParams ?? Promise.resolve(EMPTY_SEARCH_PARAMS),
  ]);
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
  if (!detail) {
    const mergedTarget = await scope.objects.getMergedObjectTarget(id);
    if (mergedTarget) redirect(`/app/objects/${mergedTarget.id}`);
    notFound();
  }

  await scope.objects.markVisited(detail.id);
  const [boardContext, pendingBundles, projects, primaryProjects] = await Promise.all([
    scope.boards.listObjectBoardContext(detail.id),
    scope.suggestions.listPendingSuggestions(),
    detail.type === 'task'
      ? scope.objects.listObjects({ type: 'project', archived: false, limit: 200 })
      : Promise.resolve([]),
    detail.type === 'task'
      ? scope.objects.listPrimaryProjectsForTasks([detail.id])
      : Promise.resolve([]),
  ]);
  const boardItemIds = new Set(boardContext.map((row) => row.itemId));
  const suggestions = pendingBundles.flatMap((bundle) => {
    const items = objectPageSuggestionItems(bundle, detail.id, boardItemIds);
    return items.length > 0 ? [serializeSuggestionBundle({ ...bundle, items })] : [];
  });

  return (
    <div className="space-y-4">
      <HistoryBackLink
        fallbackHref={safeSameOriginPath(firstParam(query.returnTo), '/app/objects')}
        label="Back"
      />
      <ObjectBoardContext rows={boardContext} />
      <ObjectDetailClient
        detail={detail}
        userId={session.user.id}
        suggestions={suggestions}
        projects={projects.map((project) => ({ id: project.id, label: project.canonicalName }))}
        primaryProject={primaryProjects[0] ?? null}
      />
    </div>
  );
}
