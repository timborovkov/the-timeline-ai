import { NarrowContainer } from '@/components/narrow-container';
import { Skeleton } from '@/components/ui/skeleton';

export default function TelegramLoading() {
  return (
    <NarrowContainer>
      <div className="space-y-8">
        <header>
          <Skeleton className="h-7 w-32" />
          <Skeleton className="mt-2 h-4 w-80" />
        </header>
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="rounded-xl border bg-card">
            <div className="p-6">
              <Skeleton className="h-5 w-40" />
            </div>
            <div className="space-y-3 px-6 pb-6">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
            </div>
          </div>
        ))}
      </div>
    </NarrowContainer>
  );
}
