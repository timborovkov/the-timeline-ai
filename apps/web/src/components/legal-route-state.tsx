import type { ReactNode } from 'react';

import { ErrorState } from '@/components/error-state';
import { PublicShell } from '@/components/public-shell';
import { Skeleton } from '@/components/ui/skeleton';

interface LegalRouteStateProps {
  eyebrow: string;
  title: string;
  description: string;
}

interface LegalRouteErrorProps extends LegalRouteStateProps {
  error: Error & { digest?: string };
  reset: () => void;
}

function LegalRouteFrame({
  eyebrow,
  title,
  description,
  children,
}: LegalRouteStateProps & { children: ReactNode }) {
  return (
    <PublicShell width="reading" footerLabel="The Timeline legal">
      <main id="main" className="mx-auto max-w-4xl px-4 py-12 sm:px-6 sm:py-16">
        <p className="text-xs font-medium text-fg-muted">{eyebrow}</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-fg sm:text-4xl">{title}</h1>
        <p className="mt-4 max-w-[70ch] text-base leading-7 text-fg-muted">{description}</p>
        {children}
      </main>
    </PublicShell>
  );
}

export function LegalRouteLoading({ eyebrow, title, description }: LegalRouteStateProps) {
  return (
    <LegalRouteFrame eyebrow={eyebrow} title={title} description={description}>
      <output className="sr-only" aria-live="polite">
        Loading {title}
      </output>
      <section
        aria-busy="true"
        aria-label={`${title} loading placeholder`}
        className="mt-10 max-w-[70ch] space-y-5"
      >
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="space-y-2">
            <Skeleton className="h-4 w-full motion-reduce:animate-none" />
            <Skeleton className="h-4 w-11/12 motion-reduce:animate-none" />
            <Skeleton className="h-4 w-4/5 motion-reduce:animate-none" />
          </div>
        ))}
      </section>
    </LegalRouteFrame>
  );
}

export function LegalRouteError({
  eyebrow,
  title,
  description,
  error,
  reset,
}: LegalRouteErrorProps) {
  return (
    <LegalRouteFrame eyebrow={eyebrow} title={title} description={description}>
      <div className="mt-10 max-w-[70ch]">
        <ErrorState
          title={`Unable to load ${title}`}
          description={`This error did not change the ${title} or your saved information. Check your connection, then try again.`}
          error={error}
          reset={reset}
        />
      </div>
    </LegalRouteFrame>
  );
}
