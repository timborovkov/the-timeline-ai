import { users } from '@timeline/db';
import { getEnv } from '@timeline/shared/env';
import { OBJECT_TYPES } from '@timeline/shared/objects/types';
import { withTeam } from '@timeline/shared/team-scope';
import { inArray } from 'drizzle-orm';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import type * as objects from '@timeline/shared/objects/types';
import type { Metadata } from 'next';

import { EmptyAction } from '@/components/empty-action';
import { ObjectCleanupList } from '@/components/objects/object-cleanup-list';
import { ObjectCleanupSuggestions } from '@/components/objects/object-cleanup-suggestions';
import { PageHeader } from '@/components/page-header';
import { TaskCategoryFilterRefresh } from '@/components/tasks/task-category-filter-refresh';
import { Button } from '@/components/ui/button';
import { WorkFilterBar } from '@/components/work-filter-bar';
import { WorkSubnav } from '@/components/work-subnav';
import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { displayMemberLabel } from '@/lib/display-labels';
import { OBJECTS_SECTION_PREVIEW_SIZE, loadObjectRowsPage } from '@/lib/object-page';
import { OBJECT_TYPE_LABELS } from '@/lib/object-type-labels';
import { loadProjectFilterRows } from '@/lib/project-filter-options';
import { serializeSuggestionBundle } from '@/lib/suggestions';
import {
  WORK_FILTER_PARAM_KEYS,
  hasActiveWorkFilters,
  objectListFilterFromWorkFilters,
  parseWorkFilters,
  taskCategoryFilterKeys,
  workFilterHiddenParams,
} from '@/lib/work-filters';

export const metadata: Metadata = {
  title: 'Objects',
  description: 'Browse tracked timeline objects.',
};

type ObjectCountFilter = Omit<objects.ObjectListFilter, 'cursor' | 'limit' | 'offset'>;

interface ObjectListScope {
  listObjects(filter: objects.ObjectListFilter): Promise<objects.ObjectRow[]>;
  countObjects(filter: ObjectCountFilter): Promise<number>;
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
  const now = new Date();
  const calendarSettings = await scope.calendar.getCalendarSettings();
  const filterTime = { now, timezone: calendarSettings.defaultTimezone };
  const params = await searchParams;
  const filters = parseWorkFilters(params, {
    taskCategoriesEnabled: getEnv().TASK_CATEGORY_UI_ENABLED,
  });
  const categoryKeys = taskCategoryFilterKeys(filters);
  const categoryFilterBaseline =
    categoryKeys.length > 0
      ? await scope.objects.getTaskCategoryFilterRefreshState(
          {
            ...objectListFilterFromWorkFilters({ ...filters, category: '' }, filterTime),
            type: 'task',
            archived: false,
          },
          categoryKeys,
        )
      : null;
  const filterParams = workFilterHiddenParams(params, WORK_FILTER_PARAM_KEYS);
  const contextualTaskFilter = Boolean(filters.category || filters.project);
  const objectFilter = {
    ...objectListFilterFromWorkFilters(filters, filterTime),
    ...(contextualTaskFilter && !filters.type ? { type: 'task' as const } : {}),
    archived: false,
  } satisfies objects.ObjectListFilter;

  const selectedTypes = filters.type
    ? filters.type.split(',').filter(Boolean)
    : contextualTaskFilter
      ? ['task']
      : [];
  const singleType = selectedTypes.length === 1 ? selectedTypes[0] : undefined;
  const hasTypeFilter = selectedTypes.length > 0;
  const filterBarHiddenParams = filters.type ? { type: filters.type } : undefined;
  const activeFilters = hasActiveWorkFilters(filters);
  const unfilteredObjectFilter = {
    ...objectListFilterFromWorkFilters(
      parseWorkFilters({}, { taskCategoriesEnabled: getEnv().TASK_CATEGORY_UI_ENABLED }),
      filterTime,
    ),
    archived: false,
  } satisfies objects.ObjectListFilter;

  const [projects, objectWindow, inventoryTotal, suggestionBundles, members] = await Promise.all([
    loadProjectFilterRows({
      listObjects: (filter) => scope.objects.listObjects(filter),
      selected: filters.project,
      includeArchivedSelected: true,
    }),
    hasTypeFilter
      ? loadTypedObjectPage(scope.objects, { filter: objectFilter })
      : loadObjectSectionPreviews(scope.objects, { filter: objectFilter, filterParams }),
    activeFilters ? scope.objects.countObjects(unfilteredObjectFilter) : Promise.resolve(null),
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
      label: displayMemberLabel(user),
    };
  });
  const rows = objectWindow.rows;
  const objectPinState = await scope.pins.isPinnedMany(
    rows.map((row) => ({ kind: 'object' as const, key: row.id })),
  );
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
        item.status === 'pending' &&
        (item.targetKind === 'object_merge' ||
          (item.targetKind === 'object' && item.operation === 'archive_or_cancel')),
    );
    for (const item of items) {
      if (item.targetKind === 'object_merge' && item.status === 'pending') {
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
    <div className="space-y-6">
      <PageHeader
        variant="collection"
        title="Objects"
        subtitle="Projects, people, decisions, and other durable team context."
        metadata={[
          { label: 'Total', value: objectWindow.totalCount, mono: true },
          ...(singleType
            ? [{ label: 'Type', value: OBJECT_TYPE_LABELS[singleType] ?? singleType }]
            : []),
        ]}
        trailing={
          <Button asChild>
            <Link href="/app/objects/new">New object</Link>
          </Button>
        }
      />
      <WorkSubnav current="/app/objects" />

      <WorkFilterBar
        mode="objects"
        basePath="/app/objects"
        filters={filters}
        active={hasActiveWorkFilters(filters)}
        resultCount={objectWindow.totalCount}
        totalCount={inventoryTotal ?? objectWindow.totalCount}
        hiddenParams={filterBarHiddenParams}
        members={memberOptions}
        projects={projects.map((project) => ({ id: project.id, label: project.canonicalName }))}
        typeLabels={OBJECT_TYPE_LABELS}
      />
      {categoryFilterBaseline ? (
        <TaskCategoryFilterRefresh
          surface="objects"
          filters={filters}
          baselineToken={categoryFilterBaseline.token}
        />
      ) : null}

      <ObjectCleanupSuggestions
        suggestions={cleanupSuggestions}
        mergePreviewsByItemId={mergePreviewsByItemId}
      />

      {rows.length === 0 ? (
        <EmptyAction
          title={activeFilters ? 'No objects match this filter' : 'No objects yet'}
          body="Objects are extracted from captured work. You can also create one manually when you already know what should be tracked."
          href={activeFilters ? '/app/objects' : '/app#capture'}
          action={activeFilters ? 'Clear filter' : 'Capture first note'}
        />
      ) : (
        <ObjectCleanupList
          rows={rows.map((row) => ({
            ...row,
            pinned: objectPinState[`object:${row.id}`] ?? false,
          }))}
          typeLabels={OBJECT_TYPE_LABELS}
          nextCursor={hasTypeFilter ? objectWindow.nextCursor : null}
          filterParams={hasTypeFilter ? filterParams : undefined}
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
  }: {
    filter: objects.ObjectListFilter;
  },
): Promise<{
  rows: objects.ObjectRow[];
  hasNextPage: boolean;
  nextCursor: string | null;
  totalCount: number;
  sectionMoreHrefs?: Record<string, string>;
}> {
  const [page, totalCount] = await Promise.all([
    loadObjectRowsPage(objectScope, null, filter),
    objectScope.countObjects(filter),
  ]);
  return {
    rows: page.rows,
    hasNextPage: Boolean(page.nextCursor),
    nextCursor: page.nextCursor,
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

function objectsPageHref(params: { filters?: Record<string, string> }): string {
  const query = new URLSearchParams(params.filters ?? {});
  const qs = query.toString();
  return qs ? `/app/objects?${qs}` : '/app/objects';
}
