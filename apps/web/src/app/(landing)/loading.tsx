import { LandingRecoveryShell } from '@/app/(landing)/_landing-recovery-shell';
import { Skeleton } from '@/components/ui/skeleton';

export default function LandingLoading() {
  return (
    <LandingRecoveryShell>
      <output className="sr-only" aria-live="polite">
        Loading The Timeline
      </output>
      <section
        aria-busy="true"
        aria-label="The Timeline loading placeholder"
        className="px-4 py-12 sm:px-6 sm:py-16"
      >
        <div className="mx-auto max-w-6xl">
          <h1 className="sr-only">Ask what changed.</h1>
          <div aria-hidden="true">
            <Skeleton className="h-3 w-52 motion-reduce:animate-none" />
            <div className="mt-8 grid gap-12 lg:grid-cols-[1.1fr_1fr] lg:items-center">
              <div className="space-y-5">
                <Skeleton className="h-11 w-full max-w-xl motion-reduce:animate-none sm:h-14" />
                <Skeleton className="h-11 w-4/5 max-w-md motion-reduce:animate-none sm:h-14" />
                <div className="space-y-3 pt-3">
                  <Skeleton className="h-5 w-full max-w-xl motion-reduce:animate-none" />
                  <Skeleton className="h-5 w-11/12 max-w-lg motion-reduce:animate-none" />
                  <Skeleton className="h-5 w-3/4 max-w-md motion-reduce:animate-none" />
                </div>
                <div className="flex flex-wrap gap-3 pt-3">
                  <Skeleton className="h-10 w-44 motion-reduce:animate-none" />
                  <Skeleton className="h-10 w-40 motion-reduce:animate-none" />
                </div>
              </div>
              <div className="border border-border bg-surface p-4 sm:p-5">
                <Skeleton className="h-3 w-44 motion-reduce:animate-none" />
                <div className="mt-5 space-y-3">
                  <Skeleton className="h-5 w-full motion-reduce:animate-none" />
                  <Skeleton className="h-5 w-11/12 motion-reduce:animate-none" />
                  <Skeleton className="h-5 w-4/5 motion-reduce:animate-none" />
                </div>
                <Skeleton className="mt-8 h-20 w-full motion-reduce:animate-none" />
              </div>
            </div>
            <div className="mt-14 grid gap-px overflow-hidden border border-border bg-border sm:grid-cols-2 lg:grid-cols-4">
              {Array.from({ length: 4 }).map((_, index) => (
                <div key={index} className="space-y-3 bg-bg p-4 sm:p-5">
                  <Skeleton className="h-3 w-24 motion-reduce:animate-none" />
                  <Skeleton className="h-4 w-full motion-reduce:animate-none" />
                  <Skeleton className="h-4 w-4/5 motion-reduce:animate-none" />
                </div>
              ))}
            </div>
            <div className="mt-14 border-y border-border py-12 sm:py-16">
              <Skeleton className="h-3 w-40 motion-reduce:animate-none" />
              <Skeleton className="mt-6 h-9 w-full max-w-3xl motion-reduce:animate-none sm:h-11" />
              <div className="mt-10 grid gap-px bg-border lg:grid-cols-2">
                {Array.from({ length: 2 }).map((_, index) => (
                  <div key={index} className="space-y-4 bg-bg p-6 sm:p-8">
                    <Skeleton className="h-3 w-32 motion-reduce:animate-none" />
                    <Skeleton className="h-6 w-3/4 motion-reduce:animate-none" />
                    <Skeleton className="h-4 w-full motion-reduce:animate-none" />
                    <Skeleton className="h-4 w-11/12 motion-reduce:animate-none" />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>
    </LandingRecoveryShell>
  );
}
