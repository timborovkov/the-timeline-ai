'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { TEAM_SETUP_CHECKLIST_PANEL_ID } from '@/components/onboarding-checklist';
import { useOnboardingChecklistQuery } from '@/lib/use-paginated-queries';

export function TeamSetupChecklistChip() {
  const pathname = usePathname();
  const { data, isPending } = useOnboardingChecklistQuery();
  if (isPending || !data || data.dismissed || pathname === '/app') return null;
  const completedCount = data.items.filter((item) => item.completed).length;
  if (data.items.length === 0 || completedCount === data.items.length) return null;

  return (
    <Link
      href={`/app#${TEAM_SETUP_CHECKLIST_PANEL_ID}`}
      className="hidden max-w-[12rem] truncate text-xs text-fg-dim transition-colors hover:text-fg sm:inline"
    >
      Team setup checklist {completedCount}/{data.items.length}
    </Link>
  );
}
