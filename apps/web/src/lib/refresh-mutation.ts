import { revalidatePath } from 'next/cache';

import type { MutationChange } from '@/lib/mutation-surfaces';

import { mutationSurfaces } from '@/lib/mutation-surfaces';
import { reportCaughtError } from '@/lib/sentry-report';

export function refreshMutation(change: MutationChange, operation: string): void {
  const seen = new Set<string>();
  for (const { path, type } of mutationSurfaces(change)) {
    const key = `${type ?? 'page'}:${path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    try {
      if (type) revalidatePath(path, type);
      else revalidatePath(path);
    } catch (error) {
      // Persistence already succeeded. A stale view must not make clients retry the mutation.
      reportCaughtError(error, { surface: 'server_action', operation });
    }
  }
}
