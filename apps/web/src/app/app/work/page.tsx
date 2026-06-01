import { withTeam } from '@timeline/shared/team-scope';
import {
  Box,
  CalendarDays,
  CheckSquare,
  CircleCheckBig,
  Inbox,
  KanbanSquare,
  type LucideIcon,
} from 'lucide-react';
import { redirect } from 'next/navigation';

import type { HubMetric } from '@/components/hub-status-card';
import type { Metadata } from 'next';

import { HubStatusCard } from '@/components/hub-status-card';
import { IndexStrip } from '@/components/index-strip';
import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { getWorkStatusSummary, type WorkStatusSummary } from '@/lib/hub-status';

export const metadata: Metadata = {
  title: 'Work',
  description: 'Objects, tasks, boards, calendar, inbox, and review queues.',
};

const WORK_LINKS: readonly {
  href: string;
  label: string;
  description: string;
  icon: LucideIcon;
  metrics: (summary: WorkStatusSummary) => readonly HubMetric[];
}[] = [
  {
    href: '/app/objects',
    label: 'Objects',
    description: 'People, companies, projects, decisions, deals, and other extracted records.',
    icon: Box,
    metrics: (summary) => [
      {
        label: 'tracked',
        value: summary.objectsTotal,
        tone: summary.objectsTotal ? 'signal' : 'neutral',
      },
    ],
  },
  {
    href: '/app/tasks',
    label: 'Tasks',
    description: 'Follow-ups and open work grouped by operational status.',
    icon: CheckSquare,
    metrics: (summary) => [
      { label: 'open', value: summary.tasksOpen, tone: summary.tasksOpen ? 'signal' : 'neutral' },
      {
        label: 'overdue',
        value: summary.tasksOverdue,
        tone: summary.tasksOverdue ? 'danger' : 'neutral',
      },
    ],
  },
  {
    href: '/app/boards',
    label: 'Boards',
    description: 'Saved object views for project, deal, task, and custom work queues.',
    icon: KanbanSquare,
    metrics: (summary) => [
      {
        label: 'saved',
        value: summary.boardsTotal,
        tone: summary.boardsTotal ? 'signal' : 'neutral',
      },
    ],
  },
  {
    href: '/app/calendar',
    label: 'Calendar',
    description:
      'Scheduled work, busy blocks, proposed events, and calendar-linked timeline impact.',
    icon: CalendarDays,
    metrics: (summary) => [
      {
        label: 'next 14d',
        value: summary.upcomingCalendarEvents,
        tone: summary.upcomingCalendarEvents ? 'signal' : 'neutral',
      },
    ],
  },
  {
    href: '/app/inbox',
    label: 'Inbox',
    description: 'Object activity and notifications that need a quick scan.',
    icon: Inbox,
    metrics: (summary) => [
      {
        label: 'unread',
        value: summary.unreadNotifications,
        tone: summary.unreadNotifications ? 'danger' : 'neutral',
      },
    ],
  },
  {
    href: '/app/approvals',
    label: 'Approvals',
    description: 'Agent-proposed tasks, objects, calendar changes, and document updates.',
    icon: CircleCheckBig,
    metrics: (summary) => [
      {
        label: 'pending',
        value: summary.pendingApprovals,
        tone: summary.pendingApprovals ? 'danger' : 'neutral',
      },
    ],
  },
] as const;

export default async function WorkPage() {
  const session = await auth();
  if (!session?.user) redirect('/sign-in');
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) redirect('/sign-in');
  const scope = withTeam(db, active.teamId, session.user.id);
  const summary = await getWorkStatusSummary(scope);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <IndexStrip
        srLabel={`Work · ${active.teamName} · ${WORK_LINKS.length} surfaces`}
        segments={[
          { value: 'WORK' },
          { label: 'team', value: active.teamName, signal: true },
          { label: 'surfaces', value: WORK_LINKS.length },
          ...(summary.attention > 0
            ? ([{ label: 'attention', value: summary.attention, signal: true }] as const)
            : ([] as const)),
        ]}
      />

      <div className="grid grid-cols-1 gap-px overflow-hidden border border-border sm:grid-cols-2">
        {WORK_LINKS.map((item) => (
          <HubStatusCard
            key={item.href}
            href={item.href}
            label={item.label}
            description={item.description}
            icon={item.icon}
            metrics={item.metrics(summary)}
          />
        ))}
      </div>
    </div>
  );
}
