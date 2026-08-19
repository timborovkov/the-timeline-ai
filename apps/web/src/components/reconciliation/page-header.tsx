import type { ReactNode } from 'react';

import { Breadcrumb } from '@/components/breadcrumb';
import { PageHeader } from '@/components/page-header';

const RECONCILIATION_PAGE_TITLE = 'Reconciliation';

const RECONCILIATION_PAGE_SUBTITLE =
  'Groups related captures into the same work, then proposes updates for review.';

const RECONCILIATION_BREADCRUMB = [
  { label: 'Team', href: '/app/team' },
  { label: RECONCILIATION_PAGE_TITLE },
] as const;

export function ReconciliationPageHeader({
  srLabel,
  teamName,
}: {
  srLabel?: string;
  teamName?: string;
}): ReactNode {
  return (
    <>
      <Breadcrumb items={[...RECONCILIATION_BREADCRUMB]} />
      <PageHeader
        title={RECONCILIATION_PAGE_TITLE}
        subtitle={RECONCILIATION_PAGE_SUBTITLE}
        srLabel={
          srLabel ??
          `${RECONCILIATION_PAGE_TITLE}${teamName ? ` for ${teamName}` : ''}. Admins only.`
        }
      />
    </>
  );
}
