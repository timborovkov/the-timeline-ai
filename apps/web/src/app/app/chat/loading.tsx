import { Skeleton } from '@/components/ui/skeleton';

export default function ChatLoading() {
  return (
    <div
      className="-mx-4 -my-6 flex h-[calc(100dvh-3.5rem)] md:-mx-8 md:-my-8"
      aria-busy="true"
    >
      <aside className="flex h-full w-60 shrink-0 flex-col border-r border-border bg-surface p-3">
        <Skeleton className="mb-3 h-8 w-full rounded-sm" />
        <ul className="flex-1 space-y-1">
          {Array.from({ length: 6 }).map((_, i) => (
            <li key={i}>
              <Skeleton className="h-7 w-full rounded-sm" />
            </li>
          ))}
        </ul>
      </aside>
      <div className="flex min-h-0 flex-1 flex-col px-4 py-5 md:px-8 md:py-6">
        <header className="mb-5 flex shrink-0 items-baseline gap-x-4 border-y border-border py-3">
          <Skeleton className="h-3 w-12" />
          <Skeleton className="h-3 w-32" />
          <Skeleton className="ml-auto h-3 w-20" />
        </header>
        <div className="min-h-0 flex-1" />
        <Skeleton className="h-12 w-full shrink-0 rounded-sm" />
      </div>
    </div>
  );
}
