import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { Fragment } from 'react';

const focusLink =
  'rounded-sm outline-none hover:text-fg focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2';

export function EditorialBreadcrumb({
  items,
}: {
  items: readonly { href?: string; label: string }[];
}) {
  return (
    <nav aria-label="Breadcrumb" className="mb-9">
      <ol className="flex flex-wrap items-center gap-2 text-sm text-fg-muted">
        {items.map((item, index) => {
          const last = index === items.length - 1;
          return (
            <Fragment key={`${item.label}-${item.href ?? 'current'}`}>
              {index > 0 ? (
                <li aria-hidden="true">
                  <ChevronRight className="size-3.5" />
                </li>
              ) : null}
              {last || !item.href ? (
                <li aria-current="page" className="text-fg">
                  {item.label}
                </li>
              ) : (
                <li>
                  <Link href={item.href} className={focusLink}>
                    {item.label}
                  </Link>
                </li>
              )}
            </Fragment>
          );
        })}
      </ol>
    </nav>
  );
}
