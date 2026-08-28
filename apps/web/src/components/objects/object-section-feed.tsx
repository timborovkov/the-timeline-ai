'use client';

import { presentDueDate } from '@timeline/shared/time';
import { ExternalLink } from 'lucide-react';

import { InfiniteScroll } from '@/components/collections/infinite-scroll';
import { EvidenceLink } from '@/components/evidence-link';
import {
  OBJECT_BODY_CLASS,
  OBJECT_CONTROL_CLASS,
  OBJECT_MONO_META_CLASS,
  OBJECT_QUIET_CLASS,
  OBJECT_ROW_META_CLASS,
  OBJECT_ROW_TITLE_CLASS,
  OBJECT_SECTION_CLASS,
} from '@/components/objects/object-detail-type';
import { ShowMoreList } from '@/components/ui/show-more-list';
import { useWorkspaceTimezone } from '@/components/workspace-timezone-context';
import { displayText, formatDisplayDateTime } from '@/lib/display-dates';
import { formatTaskCategoryChangeValue } from '@/lib/object-change-format';
import { statusLabel } from '@/lib/status-labels';
import { useObjectSectionQuery } from '@/lib/use-paginated-queries';
import { cn } from '@/lib/utils';

const SECTION_PREVIEW_COUNT = 3;

interface Props {
  objectId: string;
  section: 'events' | 'facts' | 'changes' | 'tasks' | 'relationships';
  title: string;
  showTitle?: boolean;
}

export function ObjectSectionFeed({ objectId, section, title, showTitle = true }: Props) {
  const query = useObjectSectionQuery(objectId, section);
  const items = query.data?.pages.flatMap((page) => page.items) ?? [];
  if (!query.isPending && items.length === 0) return null;

  const loadedCount = items.length;
  const countLabel =
    loadedCount === 0 ? null : query.hasNextPage ? `${loadedCount}+` : String(loadedCount);

  return (
    <section>
      {showTitle ? (
        <h2 className={cn(OBJECT_SECTION_CLASS, 'mb-1.5')}>
          {title}
          {countLabel ? <span className={OBJECT_MONO_META_CLASS}> · {countLabel}</span> : null}
        </h2>
      ) : null}
      {items.length === 0 && query.isPending ? (
        <p className={cn(OBJECT_QUIET_CLASS, 'leading-5')}>Loading…</p>
      ) : (
        <ShowMoreList
          items={items}
          previewCount={SECTION_PREVIEW_COUNT}
          hasMore={query.hasNextPage}
          getKey={(item, index) => sectionItemKey(item, index)}
          moreLabel={(hidden, { hasMore }) =>
            hidden > 0 ? `Show ${hidden}${hasMore ? '+' : ''} more` : 'Show more'
          }
          Item={({ item }) => (
            <div className={OBJECT_BODY_CLASS}>
              <ObjectSectionItem section={section} item={item} />
            </div>
          )}
          footer={
            query.hasNextPage || query.isFetchingNextPage || query.isFetchNextPageError ? (
              <InfiniteScroll
                hasMore={query.hasNextPage}
                loading={query.isFetchingNextPage}
                error={query.isFetchNextPageError ? 'Could not load more.' : null}
                onLoadMore={() => {
                  void query.fetchNextPage();
                }}
                boundLabel="No more matching activity"
                hideBound={items.length === 0}
              />
            ) : null
          }
        />
      )}
    </section>
  );
}

function ObjectSectionItem({ section, item }: { section: Props['section']; item: unknown }) {
  const timezone = useWorkspaceTimezone();
  const row = item as Record<string, unknown>;
  if (section === 'tasks') {
    return (
      <div className="flex items-center justify-between gap-3">
        <a
          href={`/app/objects/${String(row.id)}`}
          className={cn(OBJECT_ROW_TITLE_CLASS, 'min-w-0 truncate hover:underline')}
        >
          {text(row.canonicalName, 'Task')}
        </a>
        <span className={cn(OBJECT_MONO_META_CLASS, 'shrink-0')}>{statusLabel(text(row.status))}</span>
      </div>
    );
  }
  if (section === 'relationships') {
    return (
      <div className="flex items-center justify-between gap-3">
        <a
          href={`/app/objects/${String(row.otherId)}`}
          className={cn(OBJECT_ROW_TITLE_CLASS, 'min-w-0 truncate hover:underline')}
        >
          {text(row.otherName, 'Object')}
        </a>
        <span className={cn(OBJECT_ROW_META_CLASS, 'shrink-0')}>
          {statusLabel(text(row.direction))} · {statusLabel(text(row.kind))}
        </span>
      </div>
    );
  }
  if (section === 'facts') {
    const sharedObjects = factSharedObjects(row.sharedObjects);
    const occurredAt = rawText(row.occurredAt);
    const source = text(row.source);
    const observedAt = occurredAt
      ? formatDisplayDateTime(occurredAt, { timezone })
      : 'unknown time';
    const sourceLabel = source ? ` · ${source}` : '';
    return (
      <div className="space-y-1">
        <div className="flex flex-wrap items-start gap-2">
          <p className={cn(OBJECT_BODY_CLASS, 'line-clamp-3 min-w-0 flex-1 leading-[1.35]')}>
            {text(row.statement)}
          </p>
          {sharedObjects.length > 0 ? <SharedFactObjects objects={sharedObjects} /> : null}
        </div>
        <p className={OBJECT_ROW_META_CLASS}>
          Observed <span className={OBJECT_MONO_META_CLASS}>{observedAt}</span>
          {sourceLabel} · confidence {text(row.confidence)}
        </p>
      </div>
    );
  }
  if (section === 'events') {
    const eventId = text(row.id);
    const previewText = text(row.contentText);
    const contentText = previewText || '[empty event]';
    const occurredAt = rawText(row.occurredAt);
    const source = text(row.source);
    return (
      <div className="grid gap-1">
        <div className="flex min-w-0 items-start gap-3">
          <p
            className={cn(
              OBJECT_BODY_CLASS,
              'line-clamp-2 min-w-0 flex-1 whitespace-pre-wrap text-pretty leading-[1.35]',
            )}
          >
            {contentText}
          </p>
          {eventId ? (
            <EvidenceLink
              eventId={eventId}
              previewText={previewText}
              source={source}
              occurredAt={occurredAt}
              className={cn(
                OBJECT_CONTROL_CLASS,
                'inline-flex shrink-0 items-center gap-1 border-0 bg-transparent px-0 py-0 font-sans no-underline hover:bg-transparent hover:underline',
              )}
            >
              <ExternalLink className="size-3" />
              View
            </EvidenceLink>
          ) : null}
        </div>
        <p className={OBJECT_ROW_META_CLASS}>
          <span className={OBJECT_MONO_META_CLASS}>
            {formatDisplayDateTime(occurredAt, { timezone })}
          </span>{' '}
          · {statusLabel(source || 'unknown')}
        </p>
      </div>
    );
  }
  return (
    <div className="min-w-0">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <span className={cn(OBJECT_ROW_TITLE_CLASS, 'min-w-0 break-words')}>
          {changeFieldLabel(text(row.field))}
        </span>
        <span className={cn(OBJECT_ROW_META_CLASS, 'shrink-0')}>
          {statusLabel(text(row.actorKind))} · {statusLabel(text(row.status))}
        </span>
      </div>
      <p className={cn(OBJECT_ROW_META_CLASS, 'mt-1 line-clamp-2 break-words')}>
        {formatChangeValue(text(row.field), row.previousValue, timezone)} →{' '}
        {formatChangeValue(text(row.field), row.newValue, timezone)}
      </p>
    </div>
  );
}

function text(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return displayText(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return fallback;
}

function sectionItemKey(item: unknown, index: number): string {
  if (!item || typeof item !== 'object') return String(index);
  const id = text((item as Record<string, unknown>).id);
  return id || String(index);
}

function rawText(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return fallback;
}

function changeFieldLabel(field: string): string {
  const labels: Record<string, string> = {
    __merge__: 'Merge',
    __merged_from__: 'Merged from',
    canonicalName: 'Name',
    aliases: 'Aliases',
    dueAt: 'Due date',
    taskCategory: 'Category',
    ownerUserId: 'Owner',
    assigneeUserId: 'Assignee',
  };
  return labels[field] ?? field.replace(/([a-z])([A-Z])/g, '$1 $2');
}

function formatChangeValue(field: string, value: unknown, timezone: string): string {
  const category = formatTaskCategoryChangeValue(field, value);
  if (category !== null) return category;
  if (field === 'dueAt') {
    const due = presentDueDate(value as Date | string | null | undefined, { timezone });
    if (due.status === 'invalid') return due.compactText;
    return due.dateLabel ? `${due.label} · ${due.dateLabel}` : due.compactText;
  }
  if (value === null || value === undefined || value === '') return 'empty';
  if (Array.isArray(value)) {
    return (
      value
        .flatMap((item) => {
          const formatted = formatChangeValue('', item, timezone);
          return formatted ? [formatted] : [];
        })
        .join(', ') || 'empty'
    );
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return displayText(String(value));
  }
  if (typeof value === 'object') {
    const row = value as Record<string, unknown>;
    const canonicalName = text(row.canonicalName);
    const type = text(row.type);
    if (canonicalName && type) return `${canonicalName} (${type})`;
    if (canonicalName) return canonicalName;
    const aliases = Array.isArray(row.aliases)
      ? row.aliases.flatMap((alias) => (typeof alias === 'string' ? [displayText(alias)] : []))
      : [];
    const mergedCount = Array.isArray(row.merged_entity_ids) ? row.merged_entity_ids.length : 0;
    const parts = [
      aliases.length > 0 ? `aliases: ${aliases.join(', ')}` : '',
      mergedCount > 0 ? `${mergedCount} merged object${mergedCount === 1 ? '' : 's'}` : '',
    ].filter(Boolean);
    return parts.join(' · ') || 'updated details';
  }
  return 'updated';
}

interface SharedFactObject {
  id: string;
  canonicalName: string;
  type: string;
  role: string;
}

function factSharedObjects(value: unknown): SharedFactObject[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const row = item as Record<string, unknown>;
    const id = text(row.id);
    const canonicalName = text(row.canonicalName);
    if (!id || !canonicalName) return [];
    return [
      {
        id,
        canonicalName,
        type: text(row.type, 'object'),
        role: text(row.role, 'topic'),
      },
    ];
  });
}

function SharedFactObjects({ objects }: { objects: SharedFactObject[] }) {
  const label = `Fact (${objects.length})`;
  const objectNoun = `object${objects.length === 1 ? '' : 's'}`;
  return (
    <details className="group relative inline-flex shrink-0">
      <summary
        className={cn(
          OBJECT_CONTROL_CLASS,
          'cursor-pointer list-none marker:hidden hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/50',
        )}
      >
        {label}
        <span className="sr-only">
          Show {objects.length} other {objectNoun} sharing this fact
        </span>
      </summary>
      <div className="absolute right-0 top-full z-20 hidden w-64 pt-2 group-open:block">
        <div className="rounded-sm border border-border bg-bg p-2 shadow-lg">
          <p className={cn(OBJECT_ROW_META_CLASS, 'px-2 pb-1')}>Objects sharing this fact</p>
          <ul className="max-h-56 overflow-y-auto">
            {objects.map((object) => (
              <li key={`${object.id}:${object.role}`}>
                <a
                  href={`/app/objects/${object.id}`}
                  className="block rounded-sm px-2 py-1.5 hover:bg-surface focus-visible:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-strong focus-visible:ring-inset"
                >
                  <span className={cn(OBJECT_ROW_TITLE_CLASS, 'block truncate')}>
                    {displayText(object.canonicalName)}
                  </span>
                  <span className={cn(OBJECT_ROW_META_CLASS, 'block')}>
                    {displayText(object.type)} · {displayText(object.role)}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </details>
  );
}
