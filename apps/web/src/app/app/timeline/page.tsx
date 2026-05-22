import { users } from '@timeline/db';
import { getAudioBucket, getS3Client, getSignedGetObjectUrl, withTeam } from '@timeline/shared';
import { inArray } from 'drizzle-orm';
import { redirect } from 'next/navigation';

import { CaptureForm } from '@/components/capture-form';
import { SearchBar } from '@/components/search-bar';
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

// Drop non-UUID `?author=…` values rather than passing them to Postgres,
// which would throw on the UUID cast and 500 the page.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function parseUuid(input: string | undefined): string | undefined {
  if (!input) return undefined;
  return UUID_RE.test(input) ? input : undefined;
}

export default async function TimelinePage({ searchParams }: Props) {
  const session = await auth();
  if (!session?.user) redirect('/sign-in');

  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) redirect('/sign-in');

  const sp = await searchParams;
  const scope = withTeam(db, active.teamId, session.user.id);
  await scope.requireMembership();

  // Parse once so the indicator chip, the open-state of <details>, the form
  // inputs, and the actual query all agree on what's filtered. Raw
  // `sp.author` may contain a non-UUID, `sp.from`/`sp.to` may contain an
  // unparseable string — those are dropped by the parsers, so binding the
  // form to raw `sp.*` would show invalid values that the feed quietly
  // ignored. We keep two `to` variants because the query wants end-of-day
  // (inclusive upper bound) but the <input type="date"> wants the picked
  // day verbatim.
  const authorFilter = parseUuid(sp.author);
  const fromFilter = parseDate(sp.from);
  const toFilter = parseDate(sp.to);
  const toQueryFilter = parseEndOfDay(sp.to);

  const events = await scope.listEvents({
    authorUserId: authorFilter,
    from: fromFilter,
    to: toQueryFilter,
  });

  // Format a Date back to the YYYY-MM-DD string the <input type="date">
  // expects. Both `parseDate` and `toISOString()` treat the value as UTC,
  // so this round-trips a user-picked date cleanly.
  const toDateInputValue = (d: Date | undefined): string => (d ? d.toISOString().slice(0, 10) : '');

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

  // Sign GET URLs for any audio attachments. Phase 3 generates one per render;
  // when timeline pagination starts to matter (Phase 8) we'll cache these.
  // If S3 isn't configured in this environment, degrade gracefully — render
  // the page without playback URLs rather than 500-ing the entire timeline
  // because one column happens to reference object storage that isn't wired
  // up here.
  const audioEvents = events.filter((e) => e.contentAudioUrl);
  const audioUrlMap = new Map<string, string>();
  if (audioEvents.length > 0) {
    try {
      const s3 = getS3Client();
      const bucket = getAudioBucket();
      const pairs = await Promise.all(
        audioEvents.map(async (e) => {
          try {
            const url = await getSignedGetObjectUrl(s3, bucket, e.contentAudioUrl ?? '', 3600);
            return [e.id, url] as const;
          } catch {
            return [e.id, ''] as const;
          }
        }),
      );
      for (const [id, url] of pairs) if (url) audioUrlMap.set(id, url);
    } catch (err) {
      console.error('[timeline] audio playback unavailable — S3 not configured', err);
    }
  }

  const members = await scope.listMembers();
  const memberIds = members.map((m) => m.userId);
  const memberRows =
    memberIds.length > 0
      ? await db
          .select({ id: users.id, name: users.name, email: users.email })
          .from(users)
          .where(inArray(users.id, memberIds))
      : [];

  const hasFilters = Boolean(authorFilter ?? fromFilter ?? toFilter);

  return (
    <div>
      <header className="mb-10">
        <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Timeline</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">{active.teamName}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Reverse-chronological feed of everything captured for this team.
        </p>
      </header>

      <Card className="mb-10 transition-shadow focus-within:ring-2 focus-within:ring-ring/40">
        <CardContent className="p-6">
          <CaptureForm />
        </CardContent>
      </Card>

      <SearchBar />

      <section className="mt-10 space-y-5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-muted-foreground">Recent activity</h2>
          <details className="text-sm" open={hasFilters}>
            <summary className="cursor-pointer list-none rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground">
              Filters{hasFilters ? ' · on' : ''}
            </summary>
            <form
              method="get"
              className="mt-3 flex flex-wrap items-end gap-3 rounded-lg border bg-card p-4 text-sm"
            >
              <label className="flex flex-col gap-1">
                <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  Author
                </span>
                <select
                  name="author"
                  defaultValue={authorFilter ?? ''}
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
                <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  From
                </span>
                <input
                  type="date"
                  name="from"
                  defaultValue={toDateInputValue(fromFilter)}
                  className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  To
                </span>
                <input
                  type="date"
                  name="to"
                  defaultValue={toDateInputValue(toFilter)}
                  className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                />
              </label>
              <button
                type="submit"
                className="h-9 rounded-md border border-input bg-background px-3 text-sm transition-colors hover:bg-accent"
              >
                Apply
              </button>
            </form>
          </details>
        </div>

        <TimelineList events={events} authorMap={authorMap} audioUrlMap={audioUrlMap} />
      </section>
    </div>
  );
}
