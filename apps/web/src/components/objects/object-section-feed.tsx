'use client';

import { presentDueDate } from '@timeline/shared/time';
import { ExternalLink } from 'lucide-react';

import { EvidenceLink } from '@/components/evidence-link';
import { InfiniteScroll } from '@/components/collections/infinite-scroll';
import { VirtualList } from '@/components/collections/virtual-list';
import { useWorkspaceTimezone } from '@/components/workspace-timezone-context';
import { displayText, formatDisplayDateTime } from '@/lib/display-dates';
import { formatTaskCategoryChangeValue } from '@/lib/object-change-format';
import { useObjectSectionQuery } from '@/lib/use-paginated-queries';

interface Props {
  objectId: string;
  section: 'events' | 'facts' | 'changes' | 'tasks' | 'relationships';
  title: string;
  showTitle?: boolean;
}

export function ObjectSectionFeed({ objectId, section, title, showTitle = true }: Props) {
  const query = useObjectSectionQuery(objectId, section);
  const items = query.data?.pages.flatMap((page) => page.items) ?? [];
  return (
    <section>
      {showTitle ? <h2 className="mb-3 text-sm font-medium tracking-tight">{title}</h2> : null}
      {items.length === 0 && query.isPending ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing here yet.</p>
      ) : (
        <VirtualList
          items={items}
          getItemKey={(item, index) => String((item as { id?: unknown }).id ?? index)}
          estimateSize={72}
          gap={8}
          renderItem={(item) => (
            <div className="rounded-sm border border-border bg-surface px-4 py-3">
              <ObjectSectionItem section={section} item={item} />
            </div>
          )}
        />
      )}
      <InfiniteScroll
        hasMore={Boolean(query.hasNextPage)}
        loading={query.isFetchingNextPage}
        error={query.isFetchNextPageError ? 'Could not load more.' : null}
        onLoadMore={() => {
          void query.fetchNextPage();
        }}
        boundLabel="No more matching activity"
        hideBound={items.length === 0}
      />
    </section>
  );
}

function ObjectSectionItem({ section, item }: { section: Props['section']; item: unknown }) {
  const timezone = useWorkspaceTimezone();
  const row = item as Record<string, unknown>;
  if (section === 'tasks') {
    return (
      <div className="flex items-center justify-between">
        <a href={`/app/objects/${String(row.id)}`} className="font-medium hover:underline">
          {text(row.canonicalName, 'Task')}
        </a>
        <span className="text-xs text-muted-foreground">{text(row.status)}</span>
      </div>
    );
  }
  if (section === 'relationships') {
    return (
      <div className="flex items-center justify-between">
        <a href={`/app/objects/${String(row.otherId)}`} className="font-medium hover:underline">
          {text(row.otherName, 'Object')}
        </a>
        <span className="text-xs uppercase tracking-wide text-muted-foreground">
          {text(row.direction)} · {text(row.kind)}
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
      <div className="space-y-2">
        <div className="flex flex-wrap items-start gap-2">
          <p className="min-w-0 flex-1">{text(row.statement)}</p>
          {sharedObjects.length > 0 ? <SharedFactObjects objects={sharedObjects} /> : null}
        </div>
        <p className="text-[11px] text-muted-foreground">
          Observed {observedAt}
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
      <div className="grid gap-3">
        <div className="flex min-w-0 items-start gap-4">
          <p className="line-clamp-5 min-w-0 flex-1 whitespace-pre-wrap text-pretty leading-6">
            {contentText}
          </p>
          {eventId ? (
            <EvidenceLink
              eventId={eventId}
              previewText={previewText}
              source={source}
              occurredAt={occurredAt}
              className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-sm border border-border px-3 text-[11px] text-muted-foreground transition-[border-color,color,background-color,scale] duration-150 ease-out hover:border-border-strong hover:bg-background hover:text-foreground active:scale-[0.96]"
            >
              <ExternalLink className="size-3" />
              View evidence
            </EvidenceLink>
          ) : null}
        </div>
        <p className="text-[11px] text-fg-dim">
          {formatDisplayDateTime(occurredAt, { timezone })} · {source}
        </p>
      </div>
    );
  }
  return (
    <div className="min-w-0">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <span className="min-w-0 break-words font-medium">{changeFieldLabel(text(row.field))}</span>
        <span className="shrink-0 text-[11px] uppercase tracking-wide text-muted-foreground">
          {text(row.actorKind)} · {text(row.status)}
        </span>
      </div>
      <p className="mt-1 break-words text-xs text-muted-foreground">
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
      <summary className="cursor-pointer list-none rounded-sm border border-signal/30 bg-signal-soft px-2 py-0.5 text-xs text-signal transition hover:border-signal/60 hover:bg-signal/20 marker:hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/40 focus-visible:ring-offset-2 focus-visible:ring-offset-bg">
        {label}
        <span className="sr-only">
          Show {objects.length} other {objectNoun} sharing this fact
        </span>
      </summary>
      <div className="absolute right-0 top-full z-20 hidden w-64 pt-2 group-open:block">
        <div className="rounded-sm border border-border bg-background p-2 shadow-lg">
          <p className="px-2 pb-1 text-[11px] text-fg-dim">Objects sharing this fact</p>
          <ul className="max-h-56 overflow-y-auto">
            {objects.map((object) => (
              <li key={`${object.id}:${object.role}`}>
                <a
                  href={`/app/objects/${object.id}`}
                  className="block rounded-sm px-2 py-1.5 hover:bg-surface focus-visible:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-strong focus-visible:ring-inset"
                >
                  <span className="block truncate font-medium">
                    {displayText(object.canonicalName)}
                  </span>
                  <span className="block text-[11px] text-fg-dim">
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
