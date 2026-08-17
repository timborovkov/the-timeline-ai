import { Breadcrumb } from '@/components/breadcrumb';
import { JOBS_ATTENTION_DAYS } from '@/components/job-recovery/jobs-attention';
import { PageHeader } from '@/components/page-header';

const JOBS_BREADCRUMB = [
  { label: 'Team', href: '/app/team' },
  { label: 'Background jobs' },
] as const;

export function jobsPageSubtitle(): string {
  return `Admins can retry or dismiss failed processing from the last ${String(JOBS_ATTENTION_DAYS)} days.`;
}

export function JobsPageHeader({
  teamName,
  itemCount,
  olderCount = 0,
}: {
  teamName?: string;
  itemCount?: number;
  olderCount?: number;
}) {
  return (
    <>
      <Breadcrumb items={[...JOBS_BREADCRUMB]} />
      <PageHeader
        title="Background jobs"
        subtitle={jobsPageSubtitle()}
        metadata={[
          { label: 'access', value: 'Admins only' },
          ...(teamName ? ([{ label: 'team', value: teamName, signal: true }] as const) : []),
          ...(typeof itemCount === 'number'
            ? ([
                {
                  label: 'last 7 days',
                  value: itemCount,
                  mono: true,
                  danger: itemCount > 0,
                },
              ] as const)
            : []),
          ...(olderCount > 0
            ? ([{ label: 'older hidden', value: olderCount, mono: true }] as const)
            : []),
        ]}
        srLabel={`Background jobs${teamName ? ` for ${teamName}` : ''}. Admins only.${typeof itemCount === 'number' ? ` ${String(itemCount)} from the last ${String(JOBS_ATTENTION_DAYS)} days.` : ''}${olderCount > 0 ? ` ${String(olderCount)} older jobs are hidden.` : ''}`}
      />
    </>
  );
}
