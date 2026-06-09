import { withTeam } from '@timeline/shared/team-scope';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import type { Metadata } from 'next';

import { EmptyAction } from '@/components/empty-action';
import { IndexStrip } from '@/components/index-strip';
import { ObjectMergeForm } from '@/components/objects/object-merge-form';
import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { parseObjectMergeIds } from '@/lib/object-merge';

export const metadata: Metadata = {
  title: 'Merge Objects',
  description: 'Review and merge selected workspace objects.',
};

export default async function MergeObjectsPage({
  searchParams,
}: {
  searchParams: Promise<{ ids?: string | string[]; suggestionItemId?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect('/sign-in');
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) redirect('/sign-in');

  const params = await searchParams;
  const ids = parseObjectMergeIds(params.ids);
  const suggestionItemId =
    params.suggestionItemId && parseObjectMergeIds(params.suggestionItemId).length === 1
      ? params.suggestionItemId
      : undefined;
  if (ids.length < 2) {
    return (
      <div className="mx-auto max-w-4xl space-y-6">
        <IndexStrip srLabel="Merge objects" segments={[{ value: 'MERGE' }]}>
          <Link
            href="/app/objects"
            className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-muted hover:text-fg"
          >
            back
          </Link>
        </IndexStrip>
        <EmptyAction
          title="Select objects first"
          body="Choose two or more objects from the objects list before opening merge."
          href="/app/objects"
          action="Open objects"
        />
      </div>
    );
  }

  const scope = withTeam(db, active.teamId, session.user.id);
  let preview;
  try {
    preview = await scope.objects.getObjectMergePreview(ids, ids[0]);
  } catch (err) {
    return (
      <div className="mx-auto max-w-4xl space-y-6">
        <IndexStrip srLabel="Merge objects" segments={[{ value: 'MERGE' }]}>
          <Link
            href="/app/objects"
            className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-muted hover:text-fg"
          >
            back
          </Link>
        </IndexStrip>
        <EmptyAction
          title="These objects cannot be merged"
          body={
            err instanceof Error ? err.message : 'The selected objects are no longer mergeable.'
          }
          href="/app/objects"
          action="Back to objects"
        />
      </div>
    );
  }
  if (preview.objects.length === 0) redirect('/app/objects');

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <IndexStrip
        srLabel={`Merge objects · ${preview.objects.length} selected`}
        segments={[{ value: 'MERGE' }, { label: 'selected', value: preview.objects.length }]}
      >
        <Link
          href="/app/objects"
          className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-muted hover:text-fg"
        >
          cancel
        </Link>
      </IndexStrip>
      <ObjectMergeForm
        objects={preview.objects}
        initialSurvivorId={preview.survivorId}
        countsBySurvivorId={preview.countsBySurvivorId}
        suggestionItemId={suggestionItemId}
      />
    </div>
  );
}
