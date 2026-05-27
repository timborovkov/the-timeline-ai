'use client';

import { useObjectSectionQuery } from '@/lib/use-paginated-queries';

interface Props {
  objectId: string;
  section: 'events' | 'facts' | 'changes' | 'tasks' | 'relationships';
  title: string;
}

export function ObjectSectionFeed({ objectId, section, title }: Props) {
  const query = useObjectSectionQuery(objectId, section);
  const items = query.data?.pages.flatMap((page) => page.items) ?? [];
  return (
    <section>
      <h2 className="mb-3 text-sm font-medium tracking-tight">{title}</h2>
      {items.length === 0 && query.isPending ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing here yet.</p>
      ) : (
        <ul className="space-y-2 text-sm">
          {items.map((item) => (
            <li
              key={String((item as { id?: unknown }).id)}
              className="rounded-sm border border-border bg-surface px-4 py-2"
            >
              {renderItem(section, item)}
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

function renderItem(section: Props['section'], item: unknown) {
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
    return (
      <div>
        <p>{text(row.statement)}</p>
        <p className="mt-1 text-[11px] text-muted-foreground">confidence {text(row.confidence)}</p>
      </div>
    );
  }
  if (section === 'events') {
    return (
      <div>
        <p className="whitespace-pre-wrap">{text(row.contentText, '[empty event]')}</p>
        <p className="mt-1 text-[11px] text-muted-foreground">
          {new Date(text(row.occurredAt)).toLocaleString()} · {text(row.source)}
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
