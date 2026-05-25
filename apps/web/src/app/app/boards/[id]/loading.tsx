import { Skeleton } from '@/components/ui/skeleton';

export default function BoardDetailLoading() {
  return (
    <div>
      <header className="mb-8 flex items-end justify-between gap-6">
        <div className="space-y-2">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-9 w-64" />
          <Skeleton className="h-4 w-40" />
        </div>
        <Skeleton className="h-9 w-9 rounded-md" />
      </header>

      <ul className="space-y-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <li key={i} className="rounded-md border bg-card px-4 py-3">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="mt-2 h-3 w-1/3" />
          </li>
        ))}
      </ul>
    </div>
  );
}
