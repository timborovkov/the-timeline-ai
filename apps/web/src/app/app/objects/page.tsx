import { users } from '@timeline/db';
import { OBJECT_TYPES } from '@timeline/shared/objects';
import { decodeCursor, encodeCursor } from '@timeline/shared/pagination';
import { withTeam } from '@timeline/shared/team-scope';
import { inArray } from 'drizzle-orm';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import type * as objects from '@timeline/shared/objects';
import type { Metadata } from 'next';

import { EmptyAction } from '@/components/empty-action';
import { IndexStrip } from '@/components/index-strip';
import { ObjectCleanupList } from '@/components/objects/object-cleanup-list';
import { ObjectCleanupSuggestions } from '@/components/objects/object-cleanup-suggestions';
import { WORK_BACK_LINK } from '@/components/work-back-link';
import { WorkFilterBar } from '@/components/work-filter-bar';
import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { OBJECT_TYPE_LABELS } from '@/lib/object-type-labels';
import { isActionableSuggestionStatus } from '@/lib/suggestion-status';
import { serializeSuggestionBundle } from '@/lib/suggestions';
import {
  WORK_FILTER_PARAM_KEYS,
  hasActiveWorkFilters,
  objectListFilterFromWorkFilters,
  parseWorkFilters,
  workFilterHiddenParams,
} from '@/lib/work-filters';

export const metadata: Metadata = {
  title: 'Objects',
  description: 'Browse tracked timeline objects.',
};

const OBJECTS_PAGE_SIZE = 48;
const OBJECTS_SECTION_PREVIEW_SIZE = 8;

interface ObjectListScope {
  listObjects(filter: objects.ObjectListFilter): Promise<objects.ObjectRow[]>;
  countObjects(filter: objects.ObjectCountFilter): Promise<number>;
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
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  if (!session?.user) redirect('/sign-in');
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) redirect('/sign-in');

  const scope = withTeam(db, active.teamId, session.user.id);
  const params = await searchParams;
  const filters = parseWorkFilters(params);
  const filterParams = workFilterHiddenParams(params, WORK_FILTER_PARAM_KEYS);
  const objectFilter = {
    ...objectListFilterFromWorkFilters(filters),
    archived: false,
  } satisfies objects.ObjectListFilter;

  const type = filters.type || undefined;
  const cursor = parseCursorParam(firstParam(params.cursor));
  const activeFilters = hasActiveWorkFilters(filters);

  const [objectWindow, suggestionBundles, members] = await Promise.all([
    type
      ? loadTypedObjectPage(scope.objects, { filter: { ...objectFilter, type }, cursor })
      : loadObjectSectionPreviews(scope.objects, { filter: objectFilter, filterParams }),
    scope.suggestions.listPendingSuggestions(),
    scope.timeline.listMembers(),
  ]);
  const memberIds = members.map((member) => member.userId);
  const memberRows =
    memberIds.length > 0
      ? await db
          .select({ id: users.id, name: users.name, email: users.email })
          .from(users)
          .where(inArray(users.id, memberIds))
      : [];
  const memberMap = new Map(memberRows.map((member) => [member.id, member] as const));
  const memberOptions = members.map((member) => {
    const user = memberMap.get(member.userId);
    return {
      id: member.userId,
      label: user?.name ?? user?.email ?? member.userId,
    };
  });
  const rows = objectWindow.rows;
  const nextHref =
    type && objectWindow.nextCursor
      ? objectsPageHref({
          filters: filterParams,
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
            ? `Objects · ${rows.length} shown · filtered to ${OBJECT_TYPE_LABELS[type] ?? type}`
            : `Objects · previews · ${rows.length} shown`
        }
        segments={[
          { value: 'OBJECTS' },
          ...(type ? ([{ value: 'PAGE' }] as const) : ([{ value: 'PREVIEWS' }] as const)),
          { label: 'shown', value: rows.length },
          ...(type
            ? ([{ label: 'type', value: OBJECT_TYPE_LABELS[type] ?? type, signal: true }] as const)
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
          href={objectsTypeHref(null, params)}
          aria-current={!type ? 'page' : undefined}
          className={`rounded-sm border px-2.5 py-1 transition-colors ${!type ? 'border-signal/40 bg-signal-soft text-signal' : 'border-border text-fg-muted hover:bg-surface-2 hover:text-fg'}`}
        >
          All
        </Link>
        {Object.entries(OBJECT_TYPE_LABELS).map(([key, label]) => (
          <Link
            key={key}
            href={objectsTypeHref(key, params)}
            aria-current={type === key ? 'page' : undefined}
            className={`rounded-sm border px-2.5 py-1 transition-colors ${type === key ? 'border-signal/40 bg-signal-soft text-signal' : 'border-border text-fg-muted hover:bg-surface-2 hover:text-fg'}`}
          >
            {label}
          </Link>
        ))}
      </nav>

      <WorkFilterBar
        mode="objects"
        basePath="/app/objects"
        filters={filters}
        active={hasActiveWorkFilters(filters)}
        resultCount={rows.length}
        totalCount={objectWindow.totalCount}
        hiddenParams={{}}
        members={memberOptions}
        typeLabels={OBJECT_TYPE_LABELS}
      />

      <ObjectCleanupSuggestions
        suggestions={cleanupSuggestions}
        mergePreviewsByItemId={mergePreviewsByItemId}
      />

      {rows.length === 0 ? (
        <EmptyAction
          title={
            type && cursor
              ? 'No objects on this page'
              : activeFilters
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
              ? objectsPageHref({ filters: filterParams })
              : activeFilters
                ? '/app/objects'
                : '/app#capture'
          }
          action={
            type && cursor
              ? 'Open first page'
              : activeFilters
                ? 'Clear filter'
                : 'Capture first note'
          }
        />
      ) : (
        <ObjectCleanupList
          rows={rows}
          typeLabels={OBJECT_TYPE_LABELS}
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
    filter,
    cursor,
  }: {
    filter: objects.ObjectListFilter;
    cursor: string | undefined;
  },
): Promise<{
  rows: objects.ObjectRow[];
  hasNextPage: boolean;
  nextCursor: string | null;
  totalCount: number;
  sectionMoreHrefs?: Record<string, string>;
}> {
  const [pageRows, totalCount] = await Promise.all([
    objectScope.listObjects({
      ...filter,
      limit: OBJECTS_PAGE_SIZE + 1,
      cursor,
    }),
    objectScope.countObjects(filter),
  ]);
  const rows = pageRows.slice(0, OBJECTS_PAGE_SIZE);
  const last = rows.at(-1);
  return {
    rows,
    hasNextPage: pageRows.length > OBJECTS_PAGE_SIZE,
    nextCursor:
      pageRows.length > OBJECTS_PAGE_SIZE && last
        ? encodeCursor({ at: last.updatedAt.toISOString(), id: last.id })
        : null,
    totalCount,
  };
}

async function loadObjectSectionPreviews(
  objectScope: ObjectListScope,
  {
    filter,
    filterParams,
  }: { filter: objects.ObjectListFilter; filterParams: Record<string, string> },
): Promise<{
  rows: objects.ObjectRow[];
  hasNextPage: boolean;
  nextCursor: string | null;
  totalCount: number;
  sectionMoreHrefs: Record<string, string>;
}> {
  const previews = await Promise.all(
    OBJECT_TYPES.map(async (typeKey) => {
      const typedFilter = { ...filter, type: typeKey };
      const [sectionRows, totalCount] = await Promise.all([
        objectScope.listObjects({
          ...typedFilter,
          limit: OBJECTS_SECTION_PREVIEW_SIZE + 1,
        }),
        objectScope.countObjects(typedFilter),
      ]);
      return [typeKey, sectionRows, totalCount] as const;
    }),
  );
  const sectionMoreHrefs: Record<string, string> = {};
  const rows: objects.ObjectRow[] = [];
  let totalCount = 0;
  for (const [typeKey, sectionRows, sectionTotal] of previews) {
    totalCount += sectionTotal;
    rows.push(...sectionRows.slice(0, OBJECTS_SECTION_PREVIEW_SIZE));
    if (sectionRows.length > OBJECTS_SECTION_PREVIEW_SIZE) {
      sectionMoreHrefs[typeKey] = objectsPageHref({
        filters: { ...filterParams, type: typeKey },
      });
    }
  }
  return { rows, hasNextPage: false, nextCursor: null, totalCount, sectionMoreHrefs };
}

function parseCursorParam(value: string | undefined): string | undefined {
  return decodeCursor(value) ? value : undefined;
}

function objectsPageHref(params: {
  filters?: Record<string, string>;
  cursor?: string | null;
}): string {
  const query = new URLSearchParams(params.filters ?? {});
  if (params.cursor) query.set('cursor', params.cursor);
  const qs = query.toString();
  return qs ? `/app/objects?${qs}` : '/app/objects';
}

function objectsTypeHref(
  type: string | null,
  params: Record<string, string | string[] | undefined>,
): string {
  const filters = workFilterHiddenParams(params, WORK_FILTER_PARAM_KEYS);
  if (type) filters.type = type;
  else delete filters.type;
  return objectsPageHref({ filters });
}

function firstParam(value: string | string[] | undefined): string {
  const first = Array.isArray(value) ? value[0] : value;
  return typeof first === 'string' ? first : '';
}
