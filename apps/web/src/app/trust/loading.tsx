import { MarketingContainer, MarketingSectionGrid } from '@/components/marketing/marketing-layout';
import { MarketingSectionIndex } from '@/components/marketing/section-index';
import { PublicShell } from '@/components/public-shell';
import { Skeleton } from '@/components/ui/skeleton';

const SIGNAL_CARDS = 4;
const DATA_PATH_ROWS = 4;
const PROVIDER_ROWS = 8;
const AI_ROUTE_ROWS = 4;

export default function TrustLoading() {
  return (
    <PublicShell width="expanded" currentSection="trust" footerLabel="The Timeline trust center">
      <main id="main" tabIndex={-1}>
        <output className="sr-only" aria-live="polite">
          Loading The Timeline trust center
        </output>
        <div aria-busy="true" aria-label="Trust center loading placeholder">
          <section className="border-b border-border">
            <MarketingContainer className="py-16 sm:py-24 lg:py-28">
              <p className="text-sm font-medium text-fg-muted">Trust / Security / Data privacy</p>
              <div className="mt-6 grid items-end gap-10 lg:grid-cols-[1.25fr_0.75fr]">
                <h1 className="max-w-[14ch] text-balance text-[3rem] font-semibold leading-[0.95] tracking-[-0.05em] text-fg sm:text-[clamp(3.5rem,5vw,5.5rem)]">
                  Your work should not become someone else&apos;s training set.
                </h1>
                <div className="max-w-[46ch] space-y-5" aria-hidden="true">
                  <Skeleton className="h-5 w-full motion-reduce:animate-none" />
                  <Skeleton className="h-5 w-11/12 motion-reduce:animate-none" />
                  <Skeleton className="h-5 w-4/5 motion-reduce:animate-none" />
                  <Skeleton className="h-5 w-full motion-reduce:animate-none" />
                  <Skeleton className="h-5 w-10/12 motion-reduce:animate-none" />
                </div>
              </div>
              <dl
                className="mt-14 grid gap-px overflow-hidden rounded-sm border border-border bg-border sm:grid-cols-2 xl:grid-cols-4"
                aria-hidden="true"
              >
                {Array.from({ length: SIGNAL_CARDS }).map((_, index) => (
                  <div key={index} className="bg-bg p-6 sm:p-7">
                    <Skeleton className="h-3 w-28 motion-reduce:animate-none" />
                    <Skeleton className="mt-5 h-6 w-36 motion-reduce:animate-none" />
                    <Skeleton className="mt-3 h-4 w-full motion-reduce:animate-none" />
                    <Skeleton className="mt-2 h-4 w-4/5 motion-reduce:animate-none" />
                  </div>
                ))}
              </dl>
            </MarketingContainer>
          </section>

          <section className="border-b border-border bg-surface/45">
            <MarketingContainer className="py-16 sm:py-20">
              <MarketingSectionGrid>
                <MarketingSectionIndex index="01" label="Data path" />
                <div>
                  <Skeleton className="h-10 w-full max-w-md motion-reduce:animate-none" />
                  <ol className="mt-10 border-y border-border" aria-hidden="true">
                    {Array.from({ length: DATA_PATH_ROWS }).map((_, index) => (
                      <li
                        key={index}
                        className="grid gap-3 border-b border-border py-7 last:border-b-0 sm:grid-cols-[3rem_minmax(0,0.7fr)_minmax(0,1fr)] sm:gap-6"
                      >
                        <Skeleton className="h-3 w-6 motion-reduce:animate-none" />
                        <Skeleton className="h-6 w-40 motion-reduce:animate-none" />
                        <div className="space-y-2">
                          <Skeleton className="h-4 w-full motion-reduce:animate-none" />
                          <Skeleton className="h-4 w-4/5 motion-reduce:animate-none" />
                        </div>
                      </li>
                    ))}
                  </ol>
                </div>
              </MarketingSectionGrid>
            </MarketingContainer>
          </section>

          <section className="border-b border-border">
            <MarketingContainer className="py-16 sm:py-20">
              <MarketingSectionGrid>
                <MarketingSectionIndex index="02" label="AI and training" />
                <div>
                  <div className="grid gap-8 lg:grid-cols-[minmax(0,0.72fr)_minmax(0,1.28fr)] lg:gap-14">
                    <div className="space-y-5">
                      <Skeleton className="h-10 w-full max-w-sm motion-reduce:animate-none" />
                      <Skeleton className="h-4 w-full motion-reduce:animate-none" />
                      <Skeleton className="h-4 w-11/12 motion-reduce:animate-none" />
                      <Skeleton className="h-4 w-4/5 motion-reduce:animate-none" />
                    </div>
                    <div className="border-t border-border" aria-hidden="true">
                      {Array.from({ length: AI_ROUTE_ROWS }).map((_, index) => (
                        <div
                          key={index}
                          className="grid gap-3 border-b border-border py-6 sm:grid-cols-[minmax(0,1fr)_minmax(0,0.95fr)] sm:gap-8"
                        >
                          <Skeleton className="h-4 w-40 motion-reduce:animate-none" />
                          <div className="space-y-2">
                            <Skeleton className="h-3 w-full motion-reduce:animate-none" />
                            <Skeleton className="h-3 w-32 motion-reduce:animate-none" />
                            <Skeleton className="h-3 w-3/4 motion-reduce:animate-none" />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div
                    className="mt-10 grid gap-px border border-border bg-border sm:grid-cols-3"
                    aria-hidden="true"
                  >
                    {Array.from({ length: 3 }).map((_, index) => (
                      <div key={index} className="flex gap-3 bg-bg p-5">
                        <Skeleton className="mt-0.5 size-4 shrink-0 motion-reduce:animate-none" />
                        <div className="min-w-0 flex-1 space-y-2">
                          <Skeleton className="h-4 w-full motion-reduce:animate-none" />
                          <Skeleton className="h-4 w-4/5 motion-reduce:animate-none" />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </MarketingSectionGrid>
            </MarketingContainer>
          </section>

          <section className="border-b border-border bg-surface/45">
            <MarketingContainer className="py-16 sm:py-20">
              <MarketingSectionGrid>
                <MarketingSectionIndex index="03" label="Storage and access" />
                <div className="grid gap-10 lg:grid-cols-2 lg:gap-16" aria-hidden="true">
                  {Array.from({ length: 2 }).map((_, index) => (
                    <div key={index} className="space-y-5">
                      <Skeleton className="h-10 w-3/4 motion-reduce:animate-none" />
                      <Skeleton className="h-4 w-full motion-reduce:animate-none" />
                      <Skeleton className="h-4 w-11/12 motion-reduce:animate-none" />
                      <Skeleton className="h-4 w-4/5 motion-reduce:animate-none" />
                    </div>
                  ))}
                </div>
              </MarketingSectionGrid>
            </MarketingContainer>
          </section>

          <section className="border-b border-border">
            <MarketingContainer className="py-16 sm:py-20">
              <MarketingSectionGrid>
                <MarketingSectionIndex index="04" label="Processors and retention" />
                <div>
                  <Skeleton className="h-10 w-full max-w-lg motion-reduce:animate-none" />
                  <Skeleton className="mt-5 h-4 w-full max-w-3xl motion-reduce:animate-none" />
                  <div className="mt-10 overflow-hidden border-y border-border" aria-hidden="true">
                    {Array.from({ length: PROVIDER_ROWS }).map((_, index) => (
                      <div
                        key={index}
                        className="grid gap-2 border-b border-border py-5 last:border-b-0 sm:grid-cols-[11rem_minmax(0,1fr)] sm:gap-8"
                      >
                        <Skeleton className="h-5 w-24 motion-reduce:animate-none" />
                        <Skeleton className="h-4 w-full motion-reduce:animate-none" />
                      </div>
                    ))}
                  </div>
                  <div className="mt-10" aria-hidden="true">
                    <Skeleton className="h-7 w-40 motion-reduce:animate-none" />
                    <div className="mt-4 space-y-4">
                      <Skeleton className="h-4 w-full max-w-xl motion-reduce:animate-none" />
                      <Skeleton className="h-4 w-4/5 max-w-lg motion-reduce:animate-none" />
                      <Skeleton className="h-4 w-3/4 max-w-md motion-reduce:animate-none" />
                    </div>
                  </div>
                </div>
              </MarketingSectionGrid>
            </MarketingContainer>
          </section>

          <section className="border-b border-border bg-surface/45">
            <MarketingContainer className="py-16 sm:py-20">
              <MarketingSectionGrid>
                <MarketingSectionIndex index="05" label="Assurance status" />
                <div>
                  <Skeleton className="h-10 w-full max-w-lg motion-reduce:animate-none" />
                  <div
                    className="mt-10 grid gap-px overflow-hidden border border-border bg-border md:grid-cols-2"
                    aria-hidden="true"
                  >
                    {Array.from({ length: 2 }).map((_, index) => (
                      <article key={index} className="bg-bg p-7 sm:p-8">
                        <Skeleton className="h-3 w-28 motion-reduce:animate-none" />
                        <Skeleton className="mt-5 h-7 w-3/4 motion-reduce:animate-none" />
                        <Skeleton className="mt-4 h-4 w-full motion-reduce:animate-none" />
                        <Skeleton className="mt-2 h-4 w-11/12 motion-reduce:animate-none" />
                        <Skeleton className="mt-2 h-4 w-4/5 motion-reduce:animate-none" />
                      </article>
                    ))}
                  </div>
                  <Skeleton className="mt-7 h-4 w-full max-w-2xl motion-reduce:animate-none" />
                </div>
              </MarketingSectionGrid>
            </MarketingContainer>
          </section>

          <section className="bg-surface">
            <MarketingContainer className="grid gap-10 py-16 sm:py-20 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
              <div className="space-y-5" aria-hidden="true">
                <Skeleton className="h-4 w-28 motion-reduce:animate-none" />
                <Skeleton className="h-10 w-full max-w-3xl motion-reduce:animate-none" />
                <Skeleton className="h-4 w-full max-w-3xl motion-reduce:animate-none" />
                <Skeleton className="h-4 w-4/5 max-w-2xl motion-reduce:animate-none" />
              </div>
              <div className="flex flex-col items-start gap-4 lg:items-end" aria-hidden="true">
                <Skeleton className="h-12 w-48 motion-reduce:animate-none" />
                <Skeleton className="h-5 w-56 motion-reduce:animate-none" />
              </div>
            </MarketingContainer>
          </section>
        </div>
      </main>
    </PublicShell>
  );
}
