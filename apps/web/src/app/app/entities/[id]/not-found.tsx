import { SearchX } from 'lucide-react';
import Link from 'next/link';

import { Button } from '@/components/ui/button';

export default function EntityNotFound() {
  return (
    <div>
      <header className="mb-10 flex flex-col gap-3">
        <Link
          href="/app/entities"
          className="inline-flex w-fit items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          ← All entities
        </Link>
      </header>
      <div className="flex flex-col items-center gap-4 rounded-xl border border-dashed bg-card/40 px-6 py-16 text-center">
        <SearchX className="h-6 w-6 text-muted-foreground" />
        <div className="space-y-1">
          <h2 className="text-base font-medium">Entity not found</h2>
          <p className="text-sm text-muted-foreground">
            This entity may have been merged into another, or you don't have access to it.
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href="/app/entities">Back to entities</Link>
        </Button>
      </div>
    </div>
  );
}
