import Link from 'next/link';

import type { ReactNode } from 'react';

import { Wordmark } from '@/components/brand/logo';
import { ThemeToggle } from '@/components/theme-toggle';
import { cn } from '@/lib/utils';

interface AuthShellProps {
  title: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  secondaryHref?: string;
  secondaryLabel?: string;
  secondaryPrefix?: string;
  maxWidth?: 'md' | 'lg';
}

export function AuthShell({
  title,
  subtitle,
  children,
  secondaryHref,
  secondaryLabel,
  secondaryPrefix,
  maxWidth = 'md',
}: AuthShellProps) {
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-bg px-5 py-12 text-fg">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_120%_70%_at_50%_-10%,var(--signal-soft),transparent_58%)]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 left-[max(0px,calc(50%-28rem))] hidden w-px bg-border md:block"
      />
      <div className={cn('relative w-full', maxWidth === 'lg' ? 'max-w-xl' : 'max-w-md')}>
        <div className="flex items-center justify-between gap-3">
          <Link href="/" aria-label="The Timeline home" className="inline-flex text-fg">
            <Wordmark />
          </Link>
          <ThemeToggle className="text-fg-muted hover:text-fg" />
        </div>
        <p className="mt-8 font-mono text-[11px] uppercase tracking-[0.14em] text-fg-muted">
          Secure access · Cited team memory
        </p>
        <div className="mt-4 rounded-lg border border-border bg-surface/95 p-6 backdrop-blur-sm sm:p-8">
          <header className="space-y-2 border-b border-border pb-6">
            <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
            {subtitle ? (
              <p className="max-w-lg text-sm leading-6 text-fg-muted">{subtitle}</p>
            ) : null}
          </header>
          <div className="mt-6 space-y-4">{children}</div>
        </div>
        {secondaryHref && secondaryLabel ? (
          <p className="mt-6 text-sm text-fg-muted">
            {secondaryPrefix ? `${secondaryPrefix} ` : null}
            <Link href={secondaryHref} className="text-primary hover:underline">
              {secondaryLabel}
            </Link>
            .
          </p>
        ) : null}
      </div>
    </main>
  );
}
