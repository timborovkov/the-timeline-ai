import type { ReactNode } from 'react';

import { Breadcrumb } from '@/components/breadcrumb';
import { PageHeader, type PageHeaderMetadata } from '@/components/page-header';

const RECONCILIATION_PAGE_TITLE = 'Reconciliation';

const RECONCILIATION_PAGE_SUBTITLE =
  'Timeline connects activity from different sources, checks the evidence, and proposes trustworthy updates for review.';

const RECONCILIATION_BREADCRUMB = [
  { label: 'Team', href: '/app/team' },
  { label: RECONCILIATION_PAGE_TITLE },
] as const;

const EMPTY_METADATA: PageHeaderMetadata[] = [];

export function ReconciliationPageHeader({
  metadata = EMPTY_METADATA,
  srLabel,
  subtitle = RECONCILIATION_PAGE_SUBTITLE,
  teamName,
  trailing,
}: {
  metadata?: PageHeaderMetadata[];
  srLabel?: string;
  subtitle?: ReactNode;
  teamName?: string;
  trailing?: ReactNode;
}): ReactNode {
  return (
    <>
      <Breadcrumb items={[...RECONCILIATION_BREADCRUMB]} />
      <PageHeader
        title={RECONCILIATION_PAGE_TITLE}
        subtitle={subtitle}
        metadata={[
          { label: 'access', value: 'Admins only' },
          ...(teamName ? ([{ label: 'team', value: teamName, signal: true }] as const) : []),
          ...metadata,
        ]}
        srLabel={
          srLabel ??
          `${RECONCILIATION_PAGE_TITLE}${teamName ? ` for ${teamName}` : ''}. Admins only.`
        }
        trailing={trailing}
      />
    </>
  );
}
