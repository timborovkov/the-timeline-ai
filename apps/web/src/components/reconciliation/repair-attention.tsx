'use client';

import { CollectionRow } from '@/components/collections/collection-row';
import { CollectionStatus } from '@/components/collections/collection-status';
import { eventSourceLabel } from '@/components/reconciliation/presentation';
import { repairFailureCopy } from '@/components/reconciliation/repair-copy';
import { useRegionalFormat } from '@/components/workspace-timezone-context';

export function RepairAttention({
  failures,
}: {
  failures: {
    source: string;
    code: string;
    rawEventCount: number;
    message: string;
  }[];
}) {
  const { locale } = useRegionalFormat();
  if (failures.length === 0) return null;
  return (
    <div aria-label="Evidence that needs repair">
      {failures.map((failure) => {
        const copy = repairFailureCopy(failure, locale);
        return (
          <CollectionRow key={`${failure.source}:${failure.code}`}>
            <CollectionRow.Leading>
              <CollectionStatus value="failed" label={copy.status} tone="danger" />
            </CollectionRow.Leading>
            <CollectionRow.Title title={copy.hint}>{copy.detail}</CollectionRow.Title>
            <CollectionRow.Context title={copy.hint}>
              {eventSourceLabel(failure.source)}
            </CollectionRow.Context>
          </CollectionRow>
        );
      })}
    </div>
  );
}
