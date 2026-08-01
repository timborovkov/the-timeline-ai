'use client';

import { ArrowLeft, Compass } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef } from 'react';

import { Button } from '@/components/ui/button';

export function RootNotFoundContent() {
  const titleRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  return (
    <main
      id="main"
      tabIndex={-1}
      className="flex min-h-[calc(100dvh-9.5rem)] items-center justify-center px-4 py-10 sm:px-6 sm:py-16"
    >
      <div className="w-full max-w-lg border border-border bg-surface p-5 sm:p-8">
        <div className="flex size-10 items-center justify-center border border-border bg-surface-2 text-fg-muted">
          <Compass aria-hidden="true" className="size-5" />
        </div>
        <div className="mt-5 space-y-2">
          <h1 ref={titleRef} tabIndex={-1} className="text-2xl font-semibold tracking-tight">
            Page not found
          </h1>
          <p className="text-sm leading-6 text-fg-muted">
            That address does not lead to a page in The Timeline. Nothing in your workspace was
            changed.
          </p>
        </div>
        <div className="mt-6 flex flex-wrap gap-3" aria-label="Continue navigating">
          <Button asChild size="sm">
            <Link href="/">
              <ArrowLeft aria-hidden="true" className="size-4" />
              Return home
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href="/app">Open workspace</Link>
          </Button>
        </div>
      </div>
    </main>
  );
}
