import Link from 'next/link';

import type { ReactNode } from 'react';

import { Wordmark } from '@/components/brand/logo';

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
    <main className="flex min-h-screen items-center justify-center bg-bg px-5 py-12 text-fg">
      <div className={maxWidth === 'lg' ? 'w-full max-w-xl' : 'w-full max-w-md'}>
        <Link href="/" aria-label="The Timeline home" className="inline-flex text-fg">
          <Wordmark />
        </Link>
        <header className="mt-10 space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {subtitle ? <p className="max-w-lg text-sm leading-6 text-fg-muted">{subtitle}</p> : null}
        </header>
        <div className="mt-7 space-y-4">{children}</div>
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
