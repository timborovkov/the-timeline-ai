import Link from 'next/link';

export function CollectionViewToggle<T extends string>({
  label,
  views,
  current,
  hrefFor,
}: {
  label: string;
  views: readonly T[];
  current: T;
  hrefFor: (view: T) => string;
}) {
  return (
    <nav aria-label={label} className="inline-flex overflow-hidden rounded-sm bg-surface">
      {views.map((nextView) => (
        <Link
          key={nextView}
          href={hrefFor(nextView)}
          aria-current={current === nextView ? 'page' : undefined}
          className={`min-h-9 px-3 py-2 text-xs capitalize transition-colors ${
            current === nextView
              ? 'bg-surface-2 text-fg'
              : 'text-fg-muted hover:bg-surface-2 hover:text-fg'
          }`}
        >
          {nextView}
        </Link>
      ))}
    </nav>
  );
}
