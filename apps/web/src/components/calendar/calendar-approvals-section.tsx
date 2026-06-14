'use client';

import { useState } from 'react';

import type { SuggestionBundle } from '@/components/approvals/approvals-client';

import { ApprovalsClient } from '@/components/approvals/approvals-client';

interface CalendarApprovalsSectionProps {
  suggestions: SuggestionBundle[];
  initialItemCount: number;
}

export function CalendarApprovalsSection({
  suggestions,
  initialItemCount,
}: CalendarApprovalsSectionProps) {
  const [visibleItemCount, setVisibleItemCount] = useState(initialItemCount);

  return (
    <details className="border-y border-border py-4">
      <summary className="cursor-pointer list-none">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-mono text-[11px] uppercase tracking-[0.14em] text-fg">
              Calendar approvals
            </h2>
            <p className="mt-1 text-sm text-fg-muted">
              {visibleItemCount} pending calendar proposal
              {visibleItemCount === 1 ? '' : 's'}
            </p>
          </div>
          <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-dim">
            Open
          </span>
        </div>
      </summary>
      <div className="mt-4">
        <ApprovalsClient
          suggestions={suggestions}
          allowBulkAccept={false}
          onVisiblePendingItemCountChange={setVisibleItemCount}
        />
      </div>
    </details>
  );
}
