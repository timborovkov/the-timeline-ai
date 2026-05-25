import { NarrowContainer } from '@/components/narrow-container';
import { Skeleton } from '@/components/ui/skeleton';

export default function InboxLoading() {
  return (
    <NarrowContainer>
      <header className="mb-10 flex items-end justify-between gap-6">
        <div className="space-y-2">
          <Skeleton className="h-3 w-12" />
          <Skeleton className="h-9 w-56" />
          <Skeleton className="h-4 w-80" />
        </div>
        <Skeleton className="h-8 w-28 rounded-md" />
      </header>

      <nav className="mb-6 flex gap-2">
        <Skeleton className="h-7 w-12 rounded-full" />
        <Skeleton className="h-7 w-16 rounded-full" />
      </nav>

      <ul className="space-y-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <li key={i} className="rounded-lg border bg-card px-4 py-3">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="mt-2 h-4 w-2/3" />
          </li>
        ))}
      </ul>
    </NarrowContainer>
  );
}
