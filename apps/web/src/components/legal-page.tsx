import Link from 'next/link';

import type { ReactNode } from 'react';

import { Wordmark } from '@/components/brand/logo';
import { ThemeToggle } from '@/components/theme-toggle';
import { Button } from '@/components/ui/button';
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
    <div className="min-h-screen bg-bg text-fg">
      <header className="sticky top-0 z-50 border-b border-border bg-bg/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-4xl items-center justify-between gap-4 px-4 sm:px-6">
          <Link href="/" aria-label="The Timeline home" className="text-fg">
            <Wordmark compact />
          </Link>
          <nav className="flex items-center gap-1 text-sm">
            <Link href="/privacy" className="px-3 py-2 text-fg-muted hover:text-fg">
              Privacy
            </Link>
            <Link href="/terms" className="px-3 py-2 text-fg-muted hover:text-fg">
              Terms
            </Link>
            <ThemeToggle className="text-fg-muted hover:text-fg" />
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-4 py-12 sm:px-6 sm:py-16">
        <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-fg-dim">{eyebrow}</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-normal text-fg sm:text-4xl">{title}</h1>
        <p className="mt-4 max-w-2xl text-base leading-7 text-fg-muted">{description}</p>
        <article
          className={cn(
            'mt-10 max-w-none space-y-5 text-sm leading-7 text-fg-muted',
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
      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-4xl flex-col gap-3 px-4 py-8 text-sm text-fg-muted sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <span>The Timeline legal</span>
          <div className="flex flex-wrap gap-4">
            <Link href="/help/support" className="hover:text-fg">
              Contact
            </Link>
            <Button asChild variant="link" className="h-auto p-0 text-sm text-fg-muted">
              <Link href="/app">Dashboard</Link>
            </Button>
          </div>
        </div>
      </footer>
    </div>
  );
}
