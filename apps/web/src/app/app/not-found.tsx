import { ArrowLeft, Compass } from 'lucide-react';
import Link from 'next/link';

import { Button } from '@/components/ui/button';

export default function AppNotFound() {
  return (
    <section className="mx-auto flex min-h-full max-w-lg items-center py-10 sm:py-16">
      <div className="w-full border border-border bg-surface p-5 sm:p-8">
        <div className="flex size-10 items-center justify-center border border-border bg-surface-2 text-fg-muted">
          <Compass aria-hidden="true" className="size-5" />
        </div>
        <div className="mt-5 space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">Page not found</h1>
          <p className="text-sm leading-6 text-fg-muted">
            That workspace page is unavailable or no longer exists. Nothing in your workspace was
            changed.
          </p>
        </div>
        <div className="mt-6 flex flex-wrap gap-3" aria-label="Continue navigating">
          <Button asChild size="sm">
            <Link href="/app">
              <ArrowLeft aria-hidden="true" className="size-4" />
              Go to Home
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href="/app/work">Open work</Link>
          </Button>
        </div>
      </div>
    </section>
  );
}
