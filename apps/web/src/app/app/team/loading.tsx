import { NarrowContainer } from '@/components/narrow-container';
import { Skeleton } from '@/components/ui/skeleton';

export default function TeamLoading() {
  return (
    <NarrowContainer>
      <div className="space-y-8">
        <header className="mb-2 space-y-2">
          <Skeleton className="h-3 w-12" />
          <Skeleton className="h-9 w-48" />
          <Skeleton className="h-4 w-32" />
        </header>
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="rounded-xl border bg-card">
            <div className="p-6">
              <Skeleton className="h-5 w-32" />
            </div>
            <div className="space-y-3 px-6 pb-6">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
              <Skeleton className="h-4 w-2/3" />
            </div>
          </div>
        ))}
      </div>
    </NarrowContainer>
  );
}
