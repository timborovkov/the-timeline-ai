import { withTeam } from '@timeline/shared/team-scope';
import { redirect } from 'next/navigation';

import type { ReactNode } from 'react';

import { EmptyAction } from '@/components/empty-action';
import { HistoryBackLink } from '@/components/history-back-link';
import { IndexStrip } from '@/components/index-strip';
import { ObjectMergeForm } from '@/components/objects/object-merge-form';
import {
  ObjectMergeRouteModalForm,
  ObjectMergeRouteModalFrame,
} from '@/components/objects/object-merge-route-modal';
import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { parseObjectMergeIds, parseSingleObjectMergeId } from '@/lib/object-merge';

type MergeSearchParams = Promise<{ ids?: string | string[]; suggestionItemId?: string }>;

interface Props {
  presentation: 'page' | 'modal';
  searchParams: MergeSearchParams;
}

const objectsBackLink = <HistoryBackLink fallbackHref="/app/objects" label="Back" />;

function renderPageShell(children: ReactNode, selectedCount?: number) {
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <IndexStrip
        srLabel={selectedCount ? `Merge objects · ${selectedCount} selected` : 'Merge objects'}
        segments={
          selectedCount
            ? [{ value: 'MERGE' }, { label: 'selected', value: selectedCount }]
            : [{ value: 'MERGE' }]
        }
        leading={objectsBackLink}
      />
      {children}
    </div>
  );
}

function renderModalShell(children: ReactNode) {
  return (
    <ObjectMergeRouteModalFrame
      title="Review merge"
      description="Choose the object to keep, then merge the duplicate into it."
    >
      {children}
    </ObjectMergeRouteModalFrame>
  );
}

function renderShell(presentation: Props['presentation'], children: ReactNode, count?: number) {
  return presentation === 'modal' ? renderModalShell(children) : renderPageShell(children, count);
}

export async function MergeObjectsRouteContent({ presentation, searchParams }: Props) {
  const session = await auth();
  if (!session?.user) redirect('/sign-in');
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) redirect('/sign-in');

  const params = await searchParams;
  const ids = parseObjectMergeIds(params.ids);
  const suggestionItemId = parseSingleObjectMergeId(params.suggestionItemId);
  if (ids.length < 2) {
    return renderShell(
      presentation,
      <EmptyAction
        title="Select objects first"
        body="Choose two or more objects from the objects list before opening merge."
        href="/app/objects"
        action="Open objects"
      />,
    );
  }

  const scope = withTeam(db, active.teamId, session.user.id);
  let preview;
  try {
    preview = await scope.objects.getObjectMergePreview(ids, ids[0]);
  } catch (err) {
    return renderShell(
      presentation,
      <EmptyAction
        title="These objects cannot be merged"
        body={err instanceof Error ? err.message : 'The selected objects are no longer mergeable.'}
        href="/app/objects"
        action="Back to objects"
      />,
    );
  }
  if (preview.objects.length === 0) redirect('/app/objects');

  const form =
    presentation === 'modal' ? (
      <ObjectMergeRouteModalForm preview={preview} suggestionItemId={suggestionItemId} />
    ) : (
      <ObjectMergeForm
        objects={preview.objects}
        initialSurvivorId={preview.survivorId}
        countsBySurvivorId={preview.countsBySurvivorId}
        factSamplesByObjectId={preview.factSamplesByObjectId}
        suggestionItemId={suggestionItemId}
      />
    );

  return renderShell(presentation, form, preview.objects.length);
}
