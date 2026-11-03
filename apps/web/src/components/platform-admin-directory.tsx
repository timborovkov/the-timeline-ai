import Link from 'next/link';
export function AdminSearch({ query }: { query: string }) {
  return (
    <form className="flex gap-2">
      <label className="flex-1">
        <span className="sr-only">Search by name, email, slug, or ID</span>
        <input
          name="q"
          defaultValue={query}
          placeholder="Search…"
          maxLength={200}
          className="min-h-11 w-full rounded-sm border border-border bg-bg px-3 text-sm"
        />
      </label>
      <button type="submit" className="min-h-11 rounded-sm border border-border px-4 text-sm">
        Search
      </button>
    </form>
  );
}
export function AdminPagination({
  page,
  hasNext,
  query = '',
}: {
  page: number;
  hasNext: boolean;
  query?: string;
}) {
  return (
    <nav aria-label="Pagination" className="flex items-center gap-4 text-sm">
      {page > 1 && <Link href={`?q=${encodeURIComponent(query)}&page=${page - 1}`}>Previous</Link>}
      <span>Page {page}</span>
      {hasNext && <Link href={`?q=${encodeURIComponent(query)}&page=${page + 1}`}>Next</Link>}
    </nav>
  );
}
