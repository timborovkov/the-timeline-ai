import { Skeleton } from '@/components/ui/skeleton';

interface HelpRouteLoadingProps {
  description: string;
  title: string;
  variant: 'guide' | 'support';
}

export function HelpRouteLoading({ description, title, variant }: HelpRouteLoadingProps) {
  return (
    <>
      <output className="sr-only" aria-live="polite">
        Loading {title}
      </output>
      <article className="space-y-10" aria-busy="true" aria-label={`${title} loading placeholder`}>
        <header className="max-w-3xl space-y-4">
          <p className="text-xs font-medium text-fg-muted">
            {variant === 'guide' ? 'Guide' : 'Support'}
          </p>
          <h1 className="text-3xl font-semibold tracking-tight text-fg sm:text-4xl">{title}</h1>
          <p className="text-lg text-fg-muted">{description}</p>
        </header>

        <div aria-hidden="true" className="max-w-3xl space-y-8">
          {variant === 'guide' ? (
            <>
              {Array.from({ length: 2 }).map((_, index) => (
                <section key={index} className="space-y-4 border-t border-border pt-8">
                  <Skeleton className="h-7 w-48 motion-reduce:animate-none" />
                  <Skeleton className="h-4 w-full motion-reduce:animate-none" />
                  <Skeleton className="h-4 w-11/12 motion-reduce:animate-none" />
                  <Skeleton className="h-4 w-4/5 motion-reduce:animate-none" />
                </section>
              ))}
              <section className="space-y-3 border-t border-border pt-8">
                <Skeleton className="h-5 w-20 motion-reduce:animate-none" />
                <Skeleton className="h-9 w-36 motion-reduce:animate-none" />
              </section>
            </>
          ) : (
            <section className="max-w-2xl space-y-5 border-t border-border pt-8">
              {Array.from({ length: 3 }).map((_, index) => (
                <div key={index} className="space-y-2">
                  <Skeleton className="h-4 w-24 motion-reduce:animate-none" />
                  <Skeleton className="h-10 w-full motion-reduce:animate-none" />
                </div>
              ))}
              <Skeleton className="h-28 w-full motion-reduce:animate-none" />
              <Skeleton className="h-9 w-32 motion-reduce:animate-none" />
            </section>
          )}
        </div>
      </article>
    </>
  );
}
