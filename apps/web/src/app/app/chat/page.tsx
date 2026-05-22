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
    <div>
      <header className="mb-10">
        <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Chat</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Ask the timeline</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Ask anything about what your team has captured. Every claim links back to the event it
          came from — no black-box answers.
        </p>
      </header>
      <ChatPane teamName={team?.name ?? active.teamName} />
    </div>
  );
}
