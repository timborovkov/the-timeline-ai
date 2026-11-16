'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';

import { Button } from '@/components/ui/button';

export function RefreshSuggestions() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <div className="mt-3 space-y-2">
      <p className="text-sm text-fg-muted">
        Suggestions may still be processing. Check again to see what is ready.
      </p>
      <Button
        type="button"
        variant="outline"
        disabled={pending}
        onClick={() => {
          startTransition(() => {
            router.refresh();
          });
        }}
      >
        {pending ? 'Checking…' : 'Check for suggestions'}
      </Button>
    </div>
  );
}
