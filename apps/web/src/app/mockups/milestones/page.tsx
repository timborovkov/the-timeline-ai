import { MilestoneHistory } from '@/components/mockups/milestone-history';
import { MockupShell } from '@/components/mockups/mockup-shell';

export const metadata = {
  title: 'Milestone history',
  robots: { index: false, follow: false },
};

export default function MockupMilestonesPage() {
  return (
    <MockupShell active="work">
      <MilestoneHistory />
    </MockupShell>
  );
}
