import { OBJECT_TYPES } from '@timeline/shared/objects';
import { decodeCursor, encodeCursor } from '@timeline/shared/pagination';
import { withTeam } from '@timeline/shared/team-scope';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import type * as objects from '@timeline/shared/objects';
import type { Metadata } from 'next';

import { EmptyAction } from '@/components/empty-action';
import { IndexStrip } from '@/components/index-strip';
import { ObjectCleanupList } from '@/components/objects/object-cleanup-list';
import { ObjectCleanupSuggestions } from '@/components/objects/object-cleanup-suggestions';
import { WORK_BACK_LINK } from '@/components/work-back-link';
import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { isActionableSuggestionStatus } from '@/lib/suggestion-status';
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

const OBJECTS_PAGE_SIZE = 48;
const OBJECTS_SECTION_PREVIEW_SIZE = 8;

interface ObjectListScope {
  listObjects(filter: objects.ObjectListFilter): Promise<objects.ObjectRow[]>;
}

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
  searchParams: Promise<{ type?: string; status?: string; cursor?: string }>;
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
  const cursor = parseCursorParam(params.cursor);

  const [objectWindow, suggestionBundles] = await Promise.all([
    type
      ? loadTypedObjectPage(scope.objects, { type, status, cursor })
      : loadObjectSectionPreviews(scope.objects, { status }),
    scope.suggestions.listPendingSuggestions(),
  ]);
  const rows = objectWindow.rows;
  const nextHref =
    type && objectWindow.nextCursor
      ? objectsPageHref({
          type: params.type,
          status: params.status,
          cursor: objectWindow.nextCursor,
        })
      : null;
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
        isActionableSuggestionStatus(item.status) &&
        (item.targetKind === 'object_merge' ||
          (item.targetKind === 'object' && item.operation === 'archive_or_cancel')),
    );
    for (const item of items) {
      if (item.targetKind === 'object_merge' && isActionableSuggestionStatus(item.status)) {
        mergeSuggestionItems.push(item);
      }
    }
    if (items.length > 0) cleanupSuggestions.push(serializeSuggestionBundle({ ...bundle, items }));
  }
  const mergePreviewEntries = await Promise.all(
    mergeSuggestionItems.slice(0, 5).map(async (item) => {
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
        srLabel={
          type
            ? `Objects · ${rows.length} shown · filtered to ${TYPE_LABEL[type] ?? type}`
            : `Objects · previews · ${rows.length} shown`
        }
        segments={[
          { value: 'OBJECTS' },
          ...(type ? ([{ value: 'PAGE' }] as const) : ([{ value: 'PREVIEWS' }] as const)),
          { label: 'shown', value: rows.length },
          ...(type
            ? ([{ label: 'type', value: TYPE_LABEL[type] ?? type, signal: true }] as const)
            : ([] as const)),
        ]}
        leading={WORK_BACK_LINK}
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
          title={
            type && cursor
              ? 'No objects on this page'
              : type || status
                ? 'No objects match this filter'
                : 'No objects yet'
          }
          body={
            type && cursor
              ? 'This page is empty. Earlier pages may still have objects.'
              : 'Objects are extracted from captured work. You can also create one manually when you already know what should be tracked.'
          }
          href={
            type && cursor
              ? objectsPageHref({ type: params.type, status: params.status })
              : type || status
                ? '/app/objects'
                : '/app#capture'
          }
          action={
            type && cursor
              ? 'Open first page'
              : type || status
                ? 'Clear filter'
                : 'Capture first note'
          }
        />
      ) : (
        <ObjectCleanupList
          rows={rows}
          typeLabels={TYPE_LABEL}
          pageInfo={
            type
              ? {
                  shownCount: rows.length,
                  nextHref,
                }
              : undefined
          }
          sectionMoreHrefs={objectWindow.sectionMoreHrefs}
        />
      )}
    </div>
  );
}

async function loadTypedObjectPage(
  objectScope: ObjectListScope,
  {
    type,
    status,
    cursor,
  }: {
    type: objects.ObjectType;
    status: string | undefined;
    cursor: string | undefined;
  },
): Promise<{
  rows: objects.ObjectRow[];
  hasNextPage: boolean;
  nextCursor: string | null;
  sectionMoreHrefs?: Record<string, string>;
}> {
  const pageRows = await objectScope.listObjects({
    limit: OBJECTS_PAGE_SIZE + 1,
    archived: false,
    type,
    cursor,
    ...(status ? { status } : {}),
  });
  const rows = pageRows.slice(0, OBJECTS_PAGE_SIZE);
  const last = rows.at(-1);
  return {
    rows,
    hasNextPage: pageRows.length > OBJECTS_PAGE_SIZE,
    nextCursor:
      pageRows.length > OBJECTS_PAGE_SIZE && last
        ? encodeCursor({ at: last.updatedAt.toISOString(), id: last.id })
        : null,
  };
}

async function loadObjectSectionPreviews(
  objectScope: ObjectListScope,
  { status }: { status: string | undefined },
): Promise<{
  rows: objects.ObjectRow[];
  hasNextPage: boolean;
  nextCursor: string | null;
  sectionMoreHrefs: Record<string, string>;
}> {
  const previews = await Promise.all(
    OBJECT_TYPES.map(async (typeKey) => {
      const sectionRows = await objectScope.listObjects({
        limit: OBJECTS_SECTION_PREVIEW_SIZE + 1,
        archived: false,
        type: typeKey,
        ...(status ? { status } : {}),
      });
      return [typeKey, sectionRows] as const;
    }),
  );
  const sectionMoreHrefs: Record<string, string> = {};
  const rows: objects.ObjectRow[] = [];
  for (const [typeKey, sectionRows] of previews) {
    rows.push(...sectionRows.slice(0, OBJECTS_SECTION_PREVIEW_SIZE));
    if (sectionRows.length > OBJECTS_SECTION_PREVIEW_SIZE) {
      sectionMoreHrefs[typeKey] = objectsPageHref({ type: typeKey, status });
    }
  }
  return { rows, hasNextPage: false, nextCursor: null, sectionMoreHrefs };
}

function parseCursorParam(value: string | undefined): string | undefined {
  return decodeCursor(value) ? value : undefined;
}

function objectsPageHref(params: {
  type?: string;
  status?: string;
  cursor?: string | null;
}): string {
  const query = new URLSearchParams();
  if (params.type) query.set('type', params.type);
  if (params.status) query.set('status', params.status);
  if (params.cursor) query.set('cursor', params.cursor);
  const qs = query.toString();
  return qs ? `/app/objects?${qs}` : '/app/objects';
}
