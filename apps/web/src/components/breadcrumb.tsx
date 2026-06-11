import Link from 'next/link';

import { HistoryBackLink } from '@/components/history-back-link';

interface BreadcrumbItem {
  label: string;
  href?: string;
}

/**
 * Tiny mono uppercase breadcrumb. Used across /app/team/integrations and
 * its sub-pages so back-navigation has a single canonical pattern instead
 * of bespoke "← Back to X" links per page.
 */
export function Breadcrumb({ items }: { items: BreadcrumbItem[] }) {
  const fallback = items
    .slice(0, -1)
    .reverse()
    .find((item): item is BreadcrumbItem & { href: string } => Boolean(item.href));

  return (
    <nav aria-label="Breadcrumb" className="space-y-1 pb-2 pt-1">
      {fallback ? <HistoryBackLink fallbackHref={fallback.href} label="Back" /> : null}
      <ol className="flex flex-wrap items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em] text-fg-dim">
        {items.map((item, i) => {
          const isLast = i === items.length - 1;
          return (
            <li key={`${item.label}-${String(i)}`} className="flex items-center gap-2">
              {item.href && !isLast ? (
                <Link href={item.href} className="hover:text-signal">
                  {item.label}
                </Link>
              ) : (
                <span className={isLast ? 'text-fg-muted' : ''}>{item.label}</span>
              )}
              {!isLast ? (
                <span aria-hidden className="text-fg-dim">
                  /
                </span>
              ) : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
