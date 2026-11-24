import Link from 'next/link';

import { RegionalNumber } from '@/components/regional-number';

export function AuditPagination({
  pathname,
  page,
  offset,
  rowCount,
  hasMore,
}: {
  pathname: string;
  page: number;
  offset: number;
  rowCount: number;
  hasMore: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
      <p className="text-fg-muted">
        Page <RegionalNumber value={page} /> ·{' '}
        {rowCount ? (
          <>
            Entries <RegionalNumber value={offset + 1} />–
            <RegionalNumber value={offset + rowCount} />
          </>
        ) : (
          'No entries'
        )}{' '}
        · Up to 200 per page, newest first
      </p>
      <nav aria-label="Audit pagination" className="flex gap-4">
        {page > 1 ? (
          <Link
            className="inline-flex min-h-11 items-center underline"
            href={`${pathname}?page=${page - 1}`}
          >
            Newer entries
          </Link>
        ) : null}
        {hasMore ? (
          <Link
            className="inline-flex min-h-11 items-center underline"
            href={`${pathname}?page=${page + 1}`}
          >
            Older entries
          </Link>
        ) : null}
      </nav>
    </div>
  );
}
