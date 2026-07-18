import { displayObjectTitle as displaySharedObjectTitle } from '@timeline/shared/objects/types';

import { displayObjectLabel } from '@/lib/display-labels';

export function displayObjectTitle(row: Parameters<typeof displaySharedObjectTitle>[0]): string {
  return displayObjectLabel({ canonicalName: displaySharedObjectTitle(row) });
}
