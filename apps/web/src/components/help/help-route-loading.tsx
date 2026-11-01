import { Skeleton } from '@/components/ui/skeleton';

interface HelpRouteLoadingProps {
  description: string;
  heading?: string;
  title: string;
  variant: 'guide' | 'support';
}

export function HelpRouteLoading({ description, heading, title, variant }: HelpRouteLoadingProps) {
  const visibleHeading = heading ?? title;
  return (
    <>
      <output className="sr-only" aria-live="polite">
        Loading {title}
      </output>
      <article
        className={variant === 'support' ? 'space-y-12' : 'space-y-10'}
        aria-busy="true"
        aria-label={`${title} loading placeholder`}
      >
        <header className={variant === 'guide' ? 'max-w-[70ch] space-y-4' : 'max-w-3xl space-y-4'}>
          <Skeleton className="h-10 w-28 motion-reduce:animate-none" />
          {variant === 'guide' ? (
            <div className="flex items-center gap-3">
              <Skeleton className="size-8 shrink-0 motion-reduce:animate-none" />
              <h1 className="text-3xl font-semibold tracking-tight text-fg sm:text-4xl">
                {visibleHeading}
              </h1>
            </div>
          ) : (
            <h1 className="text-3xl font-semibold tracking-tight text-fg sm:text-4xl">
              {visibleHeading}
            </h1>
          )}
          <p className="text-lg text-fg-muted">{description}</p>
        </header>

        <div aria-hidden="true" inert className="space-y-8">
          {variant === 'guide' ? (
            <>
              {Array.from({ length: 2 }).map((_, index) => (
                <section key={index} className="border-t border-border pt-8">
                  <div className="grid gap-6 lg:grid-cols-[1fr_14rem]">
                    <div className="space-y-4">
                      <Skeleton className="h-8 w-56 motion-reduce:animate-none" />
                      <Skeleton className="h-4 w-full motion-reduce:animate-none" />
                      <Skeleton className="h-4 w-11/12 motion-reduce:animate-none" />
                      <Skeleton className="h-4 w-4/5 motion-reduce:animate-none" />
                      <div className="space-y-3 pt-1">
                        <Skeleton className="h-4 w-full motion-reduce:animate-none" />
                        <Skeleton className="h-4 w-5/6 motion-reduce:animate-none" />
                        <Skeleton className="h-4 w-2/3 motion-reduce:animate-none" />
                      </div>
                    </div>
                    <div className="flex flex-col items-start gap-2 lg:pt-11">
                      <Skeleton className="h-9 w-36 motion-reduce:animate-none" />
                    </div>
                  </div>
                </section>
              ))}
              <section className="space-y-3 border-t border-border pt-8">
                <Skeleton className="h-5 w-28 motion-reduce:animate-none" />
                <div className="flex flex-wrap gap-2">
                  <Skeleton className="h-9 w-36 motion-reduce:animate-none" />
                  <Skeleton className="h-9 w-28 motion-reduce:animate-none" />
                </div>
              </section>
            </>
          ) : (
            <>
              <section className="grid gap-px border border-border bg-border sm:grid-cols-2">
                {Array.from({ length: 4 }).map((_, index) => (
                  <div key={index} className="flex flex-col bg-bg p-5 sm:p-6">
                    <Skeleton className="size-5 motion-reduce:animate-none" />
                    <Skeleton className="mt-4 h-5 w-36 motion-reduce:animate-none" />
                    <Skeleton className="mt-2 h-4 w-full motion-reduce:animate-none" />
                    <Skeleton className="mt-2 h-4 w-4/5 motion-reduce:animate-none" />
                    <Skeleton className="mt-5 h-5 w-48 motion-reduce:animate-none" />
                  </div>
                ))}
              </section>
              <section className="max-w-2xl border-t border-border pt-8">
                <div className="mb-7 space-y-2">
                  <Skeleton className="h-8 w-56 motion-reduce:animate-none" />
                  <Skeleton className="h-4 w-full motion-reduce:animate-none" />
                  <Skeleton className="h-4 w-3/4 motion-reduce:animate-none" />
                </div>
                <div className="space-y-5">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Skeleton className="h-4 w-16 motion-reduce:animate-none" />
                      <Skeleton className="h-10 w-full motion-reduce:animate-none" />
                    </div>
                    <div className="space-y-2">
                      <Skeleton className="h-4 w-16 motion-reduce:animate-none" />
                      <Skeleton className="h-10 w-full motion-reduce:animate-none" />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Skeleton className="h-4 w-24 motion-reduce:animate-none" />
                    <Skeleton className="h-10 w-full motion-reduce:animate-none" />
                  </div>
                  <div className="space-y-2">
                    <Skeleton className="h-4 w-20 motion-reduce:animate-none" />
                    <Skeleton className="h-28 w-full motion-reduce:animate-none" />
                  </div>
                  <Skeleton className="h-9 w-32 motion-reduce:animate-none" />
                </div>
              </section>
            </>
          )}
        </div>
      </article>
    </>
  );
}
