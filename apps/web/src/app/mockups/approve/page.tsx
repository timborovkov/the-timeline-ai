import { ApproveInChat } from '@/components/mockups/approve-in-chat';
import { MockupShell } from '@/components/mockups/mockup-shell';

export const metadata = {
  title: 'Approve in chat',
  robots: { index: false, follow: false },
};

export default function MockupApprovePage() {
  return (
    <MockupShell active="ask" fullBleed>
      <ApproveInChat />
    </MockupShell>
  );
}
