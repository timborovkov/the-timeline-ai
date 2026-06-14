'use client';

import { ExternalLink } from 'lucide-react';

import { EvidenceLink } from '@/components/evidence-link';
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
        <ul className="space-y-2 text-sm">
          {items.map((item) => (
            <li
              key={String((item as { id?: unknown }).id)}
              className="rounded-sm border border-border bg-surface px-4 py-2"
            >
              <ObjectSectionItem section={section} item={item} />
            </li>
          ))}
        </ul>
      )}
      <button
        type="button"
        disabled={!query.hasNextPage || query.isFetchingNextPage}
        onClick={() => {
          void query.fetchNextPage();
        }}
        className="mt-3 rounded-sm border border-border px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-fg-muted hover:bg-surface disabled:opacity-40"
      >
        {query.isFetchingNextPage ? 'Loading...' : query.hasNextPage ? 'Load more' : 'End'}
      </button>
    </section>
  );
}

function ObjectSectionItem({ section, item }: { section: Props['section']; item: unknown }) {
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
    return (
      <div className="space-y-2">
        <div className="flex flex-wrap items-start gap-2">
          <p className="min-w-0 flex-1">{text(row.statement)}</p>
          {sharedObjects.length > 0 ? <SharedFactObjects objects={sharedObjects} /> : null}
        </div>
        <p className="text-[11px] text-muted-foreground">confidence {text(row.confidence)}</p>
      </div>
    );
  }
  if (section === 'events') {
    const eventId = text(row.id);
    const contentText = text(row.contentText, '[empty event]');
    const occurredAt = text(row.occurredAt);
    const source = text(row.source);
    return (
      <div className="space-y-2">
        <div className="flex items-start gap-3">
          <p className="min-w-0 flex-1 whitespace-pre-wrap">{contentText}</p>
          {eventId ? (
            <EvidenceLink
              eventId={eventId}
              previewText={contentText}
              source={source}
              occurredAt={occurredAt}
              className="inline-flex shrink-0 items-center gap-1 rounded-sm border border-border px-2 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground"
            >
              <ExternalLink className="size-3" />
              View
            </EvidenceLink>
          ) : null}
        </div>
        <p className="text-[11px] text-muted-foreground">
          {new Date(occurredAt).toLocaleString()} · {source}
        </p>
      </div>
    );
  }
  return (
    <div>
      <div className="flex items-center justify-between">
        <span className="font-medium">{text(row.field)}</span>
        <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
          {text(row.actorKind)} · {text(row.status)}
        </span>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {JSON.stringify(row.previousValue ?? null)} {'->'} {JSON.stringify(row.newValue ?? null)}
      </p>
    </div>
  );
}

function text(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return fallback;
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
  return (
    <span className="group relative inline-flex shrink-0">
      <button
        type="button"
        aria-label={`${objects.length} other object${objects.length === 1 ? '' : 's'} share this fact`}
        className="rounded-sm border border-signal/30 bg-signal-soft px-2 py-0.5 font-mono text-[11px] uppercase tracking-[0.12em] text-signal outline-none transition hover:border-signal/60 hover:bg-signal/20 focus-visible:border-signal focus-visible:ring-2 focus-visible:ring-signal/30"
      >
        {label}
      </button>
      <span className="absolute right-0 top-full z-20 hidden w-64 pt-2 group-hover:block group-focus-within:block">
        <span className="block rounded-sm border border-border bg-background p-2 shadow-lg">
          <span className="block px-2 pb-1 font-mono text-[10px] uppercase tracking-[0.12em] text-fg-dim">
            Objects sharing this fact
          </span>
          <span className="block max-h-56 overflow-y-auto">
            {objects.map((object) => (
              <a
                key={`${object.id}:${object.role}`}
                href={`/app/objects/${object.id}`}
                className="block rounded-sm px-2 py-1.5 hover:bg-surface focus-visible:bg-surface focus-visible:outline-none"
              >
                <span className="block truncate font-medium">{object.canonicalName}</span>
                <span className="block font-mono text-[10px] uppercase tracking-[0.12em] text-fg-dim">
                  {object.type} · {object.role}
                </span>
              </a>
            ))}
          </span>
        </span>
      </span>
    </span>
  );
}
