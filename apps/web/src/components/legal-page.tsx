import type { ReactNode } from 'react';

import { PublicShell } from '@/components/public-shell';
import { cn } from '@/lib/utils';

interface LegalPageProps {
  children: ReactNode;
  eyebrow: string;
  title: string;
  description: string;
  className?: string;
}

export function LegalPage({ children, eyebrow, title, description, className }: LegalPageProps) {
  return (
    <PublicShell width="reading" footerLabel="The Timeline legal">
      <main className="mx-auto max-w-4xl px-4 py-12 sm:px-6 sm:py-16">
        <p className="text-xs font-medium text-fg-muted">{eyebrow}</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-fg sm:text-4xl">{title}</h1>
        <p className="mt-4 max-w-[70ch] text-base leading-7 text-fg-muted">{description}</p>
        <article
          className={cn(
            'mt-10 max-w-[70ch] space-y-5 text-sm leading-7 text-fg-muted',
            '[&_a]:text-primary [&_a]:hover:underline [&_h2]:pt-6 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:text-fg',
            '[&_li]:ml-5 [&_li]:list-disc [&_strong]:text-fg',
            '[&_table]:w-full [&_table]:border-collapse [&_table]:text-left [&_td]:border [&_td]:border-border [&_td]:p-3 [&_td]:align-top',
            '[&_th]:border [&_th]:border-border [&_th]:bg-surface [&_th]:p-3 [&_th]:font-medium [&_th]:text-fg',
            className,
          )}
        >
          {children}
        </article>
      </main>
    </PublicShell>
  );
}
