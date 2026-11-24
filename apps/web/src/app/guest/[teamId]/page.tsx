import { isInactiveWorkspaceError } from '@timeline/shared/platform-admin/runtime';
import { withTeam } from '@timeline/shared/team-scope';
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { z } from 'zod';

import type { GuestSelection } from '@/app/actions/guests';
import { AskGuestWorkForm } from '@/components/guest-forms';
import { SignOutButton } from '@/components/sign-out-button';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { getRequestIdentity } from '@/lib/auth';
import { hasCurrentLegalSession } from '@/lib/auth.config';
import { db } from '@/lib/db';
import { isLegalPublicationReady } from '@/lib/legal-publication';

export const metadata: Metadata = {
  title: 'Shared work',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

type SharedWorkParams = { note?: string; record?: string; q?: string };

function openItem({ note, record }: SharedWorkParams): GuestSelection | null {
  if (note && record) notFound();
  const target = note
    ? { kind: 'note' as const, id: note }
    : record
      ? { kind: 'record' as const, id: record }
      : null;
  if (target && !z.uuid().safeParse(target.id).success) notFound();
  return target;
}

async function loadSharedWork(
  teamId: string,
  userId: string,
  selection: GuestSelection | null,
  query: string,
) {
  const scope = withTeam(db, teamId, userId).guests;
  try {
    if (!(await scope.hasAccess())) return null;
    const [notes, records] = await Promise.all([
      selection?.kind === 'record' ? [] : scope.listSources(selection?.id, query),
      selection?.kind === 'note' ? [] : scope.listRecords(selection?.id, query),
    ]);
    return { notes, records };
  } catch (error) {
    if (isInactiveWorkspaceError(error)) return null;
    throw error;
  }
}

function SharedWorkNavigation({
  path,
  query,
  detail,
}: {
  path: string;
  query: string;
  detail: boolean;
}) {
  if (detail) {
    return (
      <a className="underline" href={path}>
        All shared work
      </a>
    );
  }
  return (
    <form action={path} className="flex flex-wrap items-end gap-3">
      <label className="block min-w-0 flex-1">
        <span className="text-sm font-medium">Search shared work</span>
        <Input type="search" name="q" defaultValue={query} maxLength={200} />
      </label>
      <Button type="submit" variant="outline">
        Search
      </Button>
    </form>
  );
}

function SharedRecordDetails({
  record,
}: {
  record: NonNullable<Awaited<ReturnType<typeof loadSharedWork>>>['records'][number];
}) {
  if (!record.live) return <p className="whitespace-pre-wrap break-words">{record.body}</p>;
  return (
    <dl className="space-y-2 text-sm">
      {record.status ? (
        <div className="flex gap-2">
          <dt>Status</dt>
          <dd>{record.status}</dd>
        </div>
      ) : null}
      {record.dueDate ? (
        <div className="flex gap-2">
          <dt>Due</dt>
          <dd>
            <time dateTime={record.dueDate}>{record.dueDate.slice(0, 10)}</time>
          </dd>
        </div>
      ) : null}
      <div className="text-muted-foreground">
        <dt className="sr-only">Field visibility</dt>
        <dd>Fields may be omitted when unset or unsupported by team-visible evidence.</dd>
      </div>
    </dl>
  );
}

function SharedWorkItems({
  path,
  detail,
  notes,
  records,
}: NonNullable<Awaited<ReturnType<typeof loadSharedWork>>> & { path: string; detail: boolean }) {
  return (
    <>
      {records.map((item) => (
        <article key={item.id} className="space-y-3 rounded-lg border p-4">
          <div>
            <p className="text-sm text-muted-foreground">
              {item.live ? `Live ${item.type}` : 'Published snapshot'}
            </p>
            <h2 className="font-semibold">{item.title}</h2>
          </div>
          {detail ? (
            <SharedRecordDetails record={item} />
          ) : (
            <a className="underline" href={`${path}?record=${item.id}`}>
              Open record
            </a>
          )}
        </article>
      ))}
      {notes.map((item) => (
        <article key={item.id} className="space-y-3 rounded-lg border p-4">
          <p className="whitespace-pre-wrap break-words">{item.contentText}</p>
          {detail ? null : (
            <a className="underline" href={`${path}?note=${item.id}`}>
              Open note
            </a>
          )}
        </article>
      ))}
    </>
  );
}

function SharedWorkContent({
  teamId,
  guestPath,
  selection,
  query,
  work,
}: {
  teamId: string;
  guestPath: string;
  selection: GuestSelection | null;
  query: string;
  work: NonNullable<Awaited<ReturnType<typeof loadSharedWork>>>;
}) {
  const empty = work.notes.length === 0 && work.records.length === 0;
  if (selection && empty) notFound();
  const canAsk = !empty && !query;

  return (
    <main className="mx-auto max-w-3xl space-y-6 px-4 py-8">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">Shared work</h1>
        <SignOutButton />
      </div>
      <SharedWorkNavigation path={guestPath} detail={Boolean(selection)} query={query} />
      {empty ? (
        <p>
          {query ? 'No shared work matches this search.' : 'No work is shared with this account.'}
        </p>
      ) : (
        <SharedWorkItems path={guestPath} detail={Boolean(selection)} {...work} />
      )}
      {canAsk ? (
        <AskGuestWorkForm
          key={selection?.id ?? 'shared-work'}
          teamId={teamId}
          selection={selection}
        />
      ) : null}
    </main>
  );
}

export default async function SharedWorkPage({
  params,
  searchParams,
}: {
  params: Promise<{ teamId: string }>;
  searchParams: Promise<SharedWorkParams>;
}) {
  const [{ teamId }, search, { session, impersonation }] = await Promise.all([
    params,
    searchParams,
    getRequestIdentity(),
  ]);
  if (!z.uuid().safeParse(teamId).success || impersonation) notFound();

  const selection = openItem(search);
  const query = selection ? '' : z.string().trim().max(200).catch('').parse(search.q);
  const guestPath = `/guest/${teamId}`;
  const destination = encodeURIComponent(
    selection ? `${guestPath}?${selection.kind}=${selection.id}` : guestPath,
  );

  if (!session?.user) redirect(`/sign-in?callbackUrl=${destination}`);
  if (isLegalPublicationReady() && !hasCurrentLegalSession(session.user)) {
    redirect(`/legal/accept?returnTo=${destination}`);
  }

  const work = await loadSharedWork(teamId, session.user.id, selection, query);
  if (!work) notFound();
  return (
    <SharedWorkContent
      teamId={teamId}
      guestPath={guestPath}
      selection={selection}
      query={query}
      work={work}
    />
  );
}
