import { users } from '@timeline/db';
import { withTeam } from '@timeline/shared';
import { inArray } from 'drizzle-orm';
import { redirect } from 'next/navigation';

import { CaptureForm } from '@/components/capture-form';
import { TimelineList } from '@/components/timeline-list';
import { Card, CardContent } from '@/components/ui/card';
import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';

interface Props {
  searchParams: Promise<{ author?: string; from?: string; to?: string }>;
}

function parseDate(input: string | undefined): Date | undefined {
  if (!input) return undefined;
  const d = new Date(input);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

// `<input type="date">` returns YYYY-MM-DD which parses as midnight UTC.
// For an inclusive end-of-day filter, shift the upper bound to the next
// midnight so the whole selected day's events match.
function parseEndOfDay(input: string | undefined): Date | undefined {
  const d = parseDate(input);
  if (!d) return undefined;
  return new Date(d.getTime() + 24 * 60 * 60 * 1000);
}

export default async function TimelinePage({ searchParams }: Props) {
  const session = await auth();
  if (!session?.user) redirect('/sign-in');

  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) redirect('/sign-in');

  const sp = await searchParams;
  const scope = withTeam(db, active.teamId, session.user.id);
  await scope.requireMembership();

  const events = await scope.listEvents({
    authorUserId: sp.author,
    from: parseDate(sp.from),
    to: parseEndOfDay(sp.to),
  });

  const authorIds = Array.from(
    new Set(events.map((e) => e.authorUserId).filter((v): v is string => v !== null)),
  );
  const authorRows =
    authorIds.length > 0
      ? await db
          .select({ id: users.id, name: users.name, email: users.email })
          .from(users)
          .where(inArray(users.id, authorIds))
      : [];
  const authorMap = new Map(authorRows.map((r) => [r.id, r] as const));

  const members = await scope.listMembers();
  const memberIds = members.map((m) => m.userId);
  const memberRows =
    memberIds.length > 0
      ? await db
          .select({ id: users.id, name: users.name, email: users.email })
          .from(users)
          .where(inArray(users.id, memberIds))
      : [];

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{active.teamName}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Reverse-chronological feed of everything captured for this team.
        </p>
      </header>

      <Card>
        <CardContent className="pt-6">
          <CaptureForm />
        </CardContent>
      </Card>

      <section className="space-y-4">
        <form
          method="get"
          className="flex flex-wrap items-end gap-3 rounded-md border border-dashed p-3 text-sm"
        >
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Author</span>
            <select
              name="author"
              defaultValue={sp.author ?? ''}
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            >
              <option value="">Everyone</option>
              {memberRows.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name ?? m.email}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">From</span>
            <input
              type="date"
              name="from"
              defaultValue={sp.from ?? ''}
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">To</span>
            <input
              type="date"
              name="to"
              defaultValue={sp.to ?? ''}
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            />
          </label>
          <button
            type="submit"
            className="h-9 rounded-md border border-input bg-background px-3 text-sm transition-colors hover:bg-accent"
          >
            Filter
          </button>
        </form>

        <TimelineList events={events} authorMap={authorMap} />
      </section>
    </div>
  );
}
