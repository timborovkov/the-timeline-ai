import { withTeam } from '@timeline/shared/team-scope';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';

import { changeGuestGrant } from '@/app/actions/guests';
import { InviteGuestForm } from '@/components/guest-forms';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { resolveActiveTeam } from '@/lib/active-team';
import { getRequestIdentity } from '@/lib/auth';
import { db } from '@/lib/db';

export default async function GuestSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; q?: string }>;
}) {
  const [{ session, impersonation }, { error, q }] = await Promise.all([
    getRequestIdentity(),
    searchParams,
  ]);
  if (!session?.user || impersonation) notFound();
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active || (active.role !== 'owner' && active.role !== 'admin')) notFound();
  const query = z.string().trim().max(200).catch('').parse(q);
  const { invites, notes, grants, records, recordShares } = await withTeam(
    db,
    active.teamId,
    session.user.id,
  ).guests.settings(query);
  const change = changeGuestGrant.bind(null, active.teamId);
  return (
    <div className="space-y-6">
      <Link href="/app/team?section=members" className="text-sm underline">
        Team members
      </Link>
      <PageHeader
        title="Guest access"
        subtitle="Share individual notes or publish a task or project snapshot for a specific guest."
      />
      {error ? <p role="alert">This work or guest invitation is unavailable.</p> : null}
      <InviteGuestForm key={active.teamId} teamId={active.teamId} />
      <form action="/app/team/guests" className="flex flex-wrap items-end gap-3">
        <label className="block min-w-0 grow">
          <span className="block text-sm font-medium">Find work to share</span>
          <Input type="search" name="q" defaultValue={query} maxLength={200} />
        </label>
        <Button type="submit" variant="outline">
          Search
        </Button>
        {query ? (
          <Link className="text-sm underline" href="/app/team/guests">
            Clear search
          </Link>
        ) : null}
      </form>
      {query && notes.length === 0 && records.length === 0 ? (
        <p>No eligible notes, tasks or projects match.</p>
      ) : null}

      {invites.map((invite) => {
        const published = recordShares.filter((share) => share.invitationId === invite.id);
        const shared = grants.filter((grant) => grant.invitationId === invite.id);
        const available = notes.filter(
          (note) => !shared.some((grant) => grant.sourceId === note.id),
        );
        return (
          <section key={invite.id} className="space-y-3 border-t pt-4">
            <h2 className="font-semibold">{invite.email}</h2>
            <p className="text-sm text-muted-foreground">
              {invite.acceptedByUserId
                ? 'Accepted'
                : invite.expired
                  ? 'Expired'
                  : 'Pending acceptance'}
            </p>
            {shared.map((grant) => (
              <form
                key={grant.sourceId}
                action={change}
                className="flex items-center justify-between gap-3"
              >
                <input type="hidden" name="invitation" value={invite.id} />
                <input type="hidden" name="source" value={grant.sourceId} />
                <p className="break-words">{grant.preview}</p>
                <Button type="submit" name="operation" value="unshare" variant="outline">
                  Unshare
                </Button>
              </form>
            ))}
            {available.length ? (
              <form action={change} className="flex flex-wrap items-end gap-3">
                <input type="hidden" name="invitation" value={invite.id} />
                <label className="block min-w-0 max-w-full">
                  <span className="block text-sm font-medium">Workspace note</span>
                  <select
                    className="max-w-full rounded-md border bg-background p-2 text-sm"
                    name="source"
                    required
                  >
                    <option value="">Choose a note</option>
                    {available.map((note) => (
                      <option key={note.id} value={note.id}>
                        {note.preview}
                      </option>
                    ))}
                  </select>
                </label>
                <Button type="submit" name="operation" value="share">
                  Share note
                </Button>
              </form>
            ) : null}
            {published.map((share) => (
              <form
                key={share.recordId}
                action={change}
                className="flex items-center justify-between gap-3"
              >
                <input type="hidden" name="invitation" value={invite.id} />
                <input type="hidden" name="record" value={share.recordId} />
                <p className="break-words">{share.title}</p>
                <Button type="submit" name="operation" value="unshare-record" variant="outline">
                  Unpublish record
                </Button>
              </form>
            ))}
            {records.length ? (
              <details className="space-y-3">
                <summary className="cursor-pointer font-medium">
                  Publish a task or project snapshot
                </summary>
                <p className="text-sm text-muted-foreground">
                  The guest sees the title and text you enter here. Share any supporting notes
                  separately.
                </p>
                <form action={change} className="max-w-lg space-y-3">
                  <input type="hidden" name="invitation" value={invite.id} />
                  <label className="block">
                    <span className="block text-sm font-medium">Workspace task or project</span>
                    <select
                      className="max-w-full rounded-md border bg-background p-2 text-sm"
                      name="record"
                      required
                    >
                      <option value="">Choose a record</option>
                      {records.map((record) => (
                        <option key={record.id} value={record.id}>
                          {record.name} ({record.type})
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className="text-sm font-medium">Title to share</span>
                    <Input name="title" required maxLength={200} />
                  </label>
                  <label className="block">
                    <span className="text-sm font-medium">Text to share</span>
                    <Textarea name="body" required maxLength={8000} />
                  </label>
                  <Button type="submit" name="operation" value="publish-record">
                    Publish snapshot
                  </Button>
                </form>
              </details>
            ) : null}
            <form action={change}>
              <input type="hidden" name="invitation" value={invite.id} />
              <Button type="submit" name="operation" value="revoke" variant="outline">
                Revoke guest access
              </Button>
            </form>
          </section>
        );
      })}
    </div>
  );
}
