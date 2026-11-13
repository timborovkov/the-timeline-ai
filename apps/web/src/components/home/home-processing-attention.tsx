import { PlugZap, Wrench } from 'lucide-react';

import { HomeAttention } from '@/components/home/home-attention';

export function HomeProcessingAttention({
  isAdmin,
  recoverableJobs,
  connectionIssues,
}: {
  isAdmin: boolean;
  recoverableJobs: number;
  connectionIssues: number;
}) {
  const visibleJobs = isAdmin ? recoverableJobs : 0;
  if (visibleJobs === 0 && connectionIssues === 0) return null;
  return (
    <HomeAttention
      title="Connections & processing"
      groups={[
        {
          href: '/app/team/jobs',
          label: 'Recoverable jobs',
          singularLabel: 'Recoverable job',
          count: visibleJobs,
          action: 'Retry processing',
          icon: <Wrench aria-hidden="true" />,
          danger: true,
        },
        {
          href: '/app/connections',
          label: 'Connection issues',
          singularLabel: 'Connection issue',
          count: connectionIssues,
          action: 'Repair connections',
          icon: <PlugZap aria-hidden="true" />,
          danger: true,
        },
      ]}
    />
  );
}
