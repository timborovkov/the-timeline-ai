import { Skeleton } from '@/components/ui/skeleton';

export default function ChatLoading() {
  return (
    <div className="-mx-6 -my-10 flex h-[calc(100dvh-4rem)] md:-mx-10 md:-my-14">
      <aside className="flex h-full w-60 shrink-0 flex-col border-r bg-card/40 p-3">
        <Skeleton className="mb-3 h-8 w-full rounded-md" />
        <ul className="flex-1 space-y-1">
          {Array.from({ length: 6 }).map((_, i) => (
            <li key={i}>
              <Skeleton className="h-7 w-full rounded-md" />
            </li>
          ))}
        </ul>
      </aside>
      <div className="flex min-h-0 flex-1 flex-col px-6 py-6 md:px-10 md:py-8">
        <header className="mb-6 shrink-0 space-y-2">
          <Skeleton className="h-3 w-12" />
          <Skeleton className="h-7 w-56" />
        </header>
        <div className="min-h-0 flex-1" />
        <Skeleton className="h-14 w-full shrink-0 rounded-xl" />
      </div>
    </div>
  );
}
