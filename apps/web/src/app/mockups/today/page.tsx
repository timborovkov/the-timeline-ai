import { BriefHome } from '@/components/mockups/brief-home';
import { MockupShell } from '@/components/mockups/mockup-shell';

export const metadata = {
  title: 'Brief-first home',
  robots: { index: false, follow: false },
};

export default function MockupTodayPage() {
  return (
    <MockupShell active="home">
      <BriefHome />
    </MockupShell>
  );
}
