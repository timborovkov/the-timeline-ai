import { ArrowLeft, Compass } from 'lucide-react';
import Link from 'next/link';

import { Button } from '@/components/ui/button';

export default function HelpNotFound() {
  return (
    <section className="max-w-3xl space-y-6 py-4 sm:py-8">
      <header className="space-y-3">
        <p className="text-xs font-medium text-fg-muted">Help center</p>
        <h1 className="text-3xl font-semibold tracking-tight text-fg sm:text-4xl">
          Guide not found
        </h1>
        <p className="max-w-prose text-base leading-7 text-fg-muted">
          This guide is unavailable or may have moved. Your workspace and support requests are
          unchanged.
        </p>
      </header>
      <div className="border border-border bg-surface p-5 sm:p-6">
        <div className="flex size-10 items-center justify-center border border-border bg-surface-2 text-fg-muted">
          <Compass aria-hidden="true" className="size-5" />
        </div>
        <div className="mt-5 flex flex-wrap gap-3" aria-label="Continue navigating help">
          <Button asChild size="sm">
            <Link href="/help">
              <ArrowLeft aria-hidden="true" className="size-4" />
              Browse guides
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href="/help/support">Get support</Link>
          </Button>
        </div>
      </div>
    </section>
  );
}
