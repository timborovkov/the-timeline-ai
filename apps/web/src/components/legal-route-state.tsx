import type { PublicNavigationSection } from '@/components/public-navigation';
import type { ReactNode } from 'react';

import { ErrorState } from '@/components/error-state';
import { PublicShell } from '@/components/public-shell';

interface LegalRouteStateProps {
  eyebrow: string;
  title: string;
  description: string;
  footerLabel?: string;
  currentSection?: PublicNavigationSection;
}

interface LegalRouteErrorProps extends LegalRouteStateProps {
  error: Error & { digest?: string };
  reset: () => void;
}

function LegalRouteFrame({
  eyebrow,
  title,
  description,
  footerLabel = 'The Timeline legal',
  currentSection,
  children,
}: LegalRouteStateProps & { children: ReactNode }) {
  return (
    <PublicShell
      width="reading"
      footerLabel={footerLabel}
      currentSection={currentSection}
      showAccountActions={false}
    >
      <main id="main" className="mx-auto max-w-4xl px-4 py-12 sm:px-6 sm:py-16">
        <p className="text-xs font-medium text-fg-muted">{eyebrow}</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-fg sm:text-4xl">{title}</h1>
        <p className="mt-4 max-w-[70ch] text-base leading-7 text-fg-muted">{description}</p>
        {children}
      </main>
    </PublicShell>
  );
}

export function LegalRouteError({
  eyebrow,
  title,
  description,
  footerLabel,
  currentSection,
  error,
  reset,
}: LegalRouteErrorProps) {
  return (
    <LegalRouteFrame
      eyebrow={eyebrow}
      title={title}
      description={description}
      footerLabel={footerLabel}
      currentSection={currentSection}
    >
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
