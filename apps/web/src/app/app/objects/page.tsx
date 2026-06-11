import { withTeam } from '@timeline/shared/team-scope';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import type * as objects from '@timeline/shared/objects';
import type { Metadata } from 'next';

import { EmptyAction } from '@/components/empty-action';
import { IndexStrip } from '@/components/index-strip';
import { ObjectCleanupList } from '@/components/objects/object-cleanup-list';
import { ObjectCleanupSuggestions } from '@/components/objects/object-cleanup-suggestions';
import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { serializeSuggestionBundle } from '@/lib/suggestions';

export const metadata: Metadata = {
  title: 'Objects',
  description: 'Browse tracked timeline objects.',
};

const TYPE_LABEL: Record<string, string> = {
  person: 'People',
  company: 'Companies',
  project: 'Projects',
  topic: 'Topics',
  deal: 'Deals',
  vendor: 'Vendors',
  incident: 'Incidents',
  document: 'Documents',
  decision: 'Decisions',
  hiring_loop: 'Hiring loops',
  task: 'Tasks',
  follow_up: 'Follow-ups',
  other: 'Other',
};

function objectIdsForMergeSuggestion(item: { proposedPayload: unknown }): string[] {
  if (!item.proposedPayload || typeof item.proposedPayload !== 'object') return [];
  const payload = item.proposedPayload as Record<string, unknown>;
  const objectIds = payload.objectIds;
  if (!Array.isArray(objectIds)) return [];
  const ids = objectIds.filter((value): value is string => typeof value === 'string');
  const survivorId = typeof payload.survivorId === 'string' ? payload.survivorId : null;
  if (!survivorId || !ids.includes(survivorId)) return ids;
  return [survivorId, ...ids.filter((id) => id !== survivorId)];
}

export default async function ObjectsIndexPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; status?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect('/sign-in');
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) redirect('/sign-in');

  const scope = withTeam(db, active.teamId, session.user.id);
  const params = await searchParams;

  const type =
    params.type && TYPE_LABEL[params.type] ? (params.type as objects.ObjectType) : undefined;
  const status = params.status?.trim() ?? undefined;

  // Default to hiding archived objects — `listObjects` only applies the
  // archived predicate when `filter.archived` is explicitly set, so an
  // unset value would surface archived rows in the main index and defeat
  // the archive button on the detail page. A dedicated "Archived" filter
  // chip (with `?archived=1`) is a future addition.
  const filter: objects.ObjectListFilter = { limit: 500, archived: false };
  if (type) filter.type = type;
  if (status) filter.status = status;

  const [rows, suggestionBundles] = await Promise.all([
    scope.objects.listObjects(filter),
    scope.suggestions.listPendingSuggestions(),
  ]);
  const cleanupSuggestions: ReturnType<typeof serializeSuggestionBundle>[] = [];
  const mergeSuggestionItems: {
    id: string;
    status: string;
    targetKind: string;
    proposedPayload: unknown;
  }[] = [];
  for (const bundle of suggestionBundles) {
    if (bundle.metadata.kind !== 'object_cleanup') continue;
    const items = bundle.items.filter(
      (item) =>
        item.targetKind === 'object_merge' ||
        (item.targetKind === 'object' && item.operation === 'archive_or_cancel'),
    );
    for (const item of items) {
      if (
        item.targetKind === 'object_merge' &&
        (item.status === 'pending' || item.status === 'failed')
      ) {
        mergeSuggestionItems.push(item);
      }
    }
    if (items.length > 0) cleanupSuggestions.push(serializeSuggestionBundle({ ...bundle, items }));
  }
  const mergePreviewEntries = await Promise.all(
    mergeSuggestionItems.map(async (item) => {
      const ids = objectIdsForMergeSuggestion(item);
      if (ids.length < 2) return null;
      try {
        return [item.id, await scope.objects.getObjectMergePreview(ids, ids[0])] as const;
      } catch {
        return null;
      }
    }),
  );
  const mergePreviewsByItemId = Object.fromEntries(
    mergePreviewEntries.filter((entry): entry is NonNullable<typeof entry> => Boolean(entry)),
  );

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <IndexStrip
        srLabel={`Objects · ${rows.length} total${type ? ` · filtered to ${TYPE_LABEL[type] ?? type}` : ''}`}
        segments={[
          { value: 'OBJECTS' },
          { label: 'total', value: rows.length },
          ...(type
            ? ([{ label: 'type', value: TYPE_LABEL[type] ?? type, signal: true }] as const)
            : ([] as const)),
        ]}
      >
        <Link
          href="/app/objects/new"
          className="font-mono text-[11px] uppercase tracking-[0.12em] text-signal hover:underline"
        >
          new →
        </Link>
      </IndexStrip>

      <nav
        aria-label="Filter by type"
        className="flex flex-wrap gap-1.5 font-mono text-[11px] uppercase tracking-[0.12em]"
      >
        <Link
          href="/app/objects"
          aria-current={!type ? 'page' : undefined}
          className={`rounded-sm border px-2.5 py-1 transition-colors ${!type ? 'border-signal/40 bg-signal-soft text-signal' : 'border-border text-fg-muted hover:bg-surface-2 hover:text-fg'}`}
        >
          All
        </Link>
        {Object.entries(TYPE_LABEL).map(([key, label]) => (
          <Link
            key={key}
            href={`/app/objects?type=${key}`}
            aria-current={type === key ? 'page' : undefined}
            className={`rounded-sm border px-2.5 py-1 transition-colors ${type === key ? 'border-signal/40 bg-signal-soft text-signal' : 'border-border text-fg-muted hover:bg-surface-2 hover:text-fg'}`}
          >
            {label}
          </Link>
        ))}
      </nav>

      <ObjectCleanupSuggestions
        suggestions={cleanupSuggestions}
        mergePreviewsByItemId={mergePreviewsByItemId}
      />

      {rows.length === 0 ? (
        <EmptyAction
          title={type ? 'No objects match this filter' : 'No objects yet'}
          body="Objects are extracted from captured work. You can also create one manually when you already know what should be tracked."
          href={type ? '/app/objects' : '/app#capture'}
          action={type ? 'Clear filter' : 'Capture first note'}
        />
      ) : (
        <ObjectCleanupList rows={rows} typeLabels={TYPE_LABEL} />
      )}
    </div>
  );
}
