import type { ReactNode } from 'react';

import { formatRelativeAge } from '@/lib/display-dates';

export function ReconciliationRowTime({ hint, value }: { hint: string; value: Date }): ReactNode {
  return (
    <time dateTime={value.toISOString()} title={hint} className="text-xs tabular-nums text-fg-dim">
      {formatRelativeAge(value)}
    </time>
  );
}
