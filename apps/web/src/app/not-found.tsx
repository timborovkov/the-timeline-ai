import { Compass } from 'lucide-react';
import Link from 'next/link';

import { Button } from '@/components/ui/button';

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6 py-16">
      <div className="flex max-w-md flex-col items-center gap-4 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-accent text-muted-foreground">
          <Compass className="h-5 w-5" />
        </span>
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Page not found</h1>
          <p className="text-sm text-muted-foreground">
            That URL doesn't lead anywhere. Head back to your timeline.
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href="/app/timeline">Back to timeline</Link>
        </Button>
      </div>
    </main>
  );
}
