import { withTeam } from '@timeline/shared';
import { redirect } from 'next/navigation';

import { ChatPane } from '@/components/chat/chat-pane';
import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

export default async function ChatPage() {
  const session = await auth();
  if (!session?.user) redirect('/sign-in');
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) redirect('/sign-in');

  const scope = withTeam(db, active.teamId, session.user.id);
  await scope.requireMembership();
  const team = await scope.team();

  return (
    <div className="space-y-4">
      <header className="flex items-baseline justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Ask the timeline</h1>
        <span className="text-xs text-muted-foreground">{team?.name ?? active.teamName}</span>
      </header>
      <p className="text-sm text-muted-foreground">
        Ask anything about what your team has captured. Every claim links back to the event it came
        from — no black-box answers.
      </p>
      <ChatPane teamName={team?.name ?? active.teamName} />
    </div>
  );
}
