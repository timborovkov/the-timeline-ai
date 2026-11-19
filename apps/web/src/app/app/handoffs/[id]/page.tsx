import { artifactRefCitation, numberCitations } from '@timeline/shared/citation';
import { withTeam } from '@timeline/shared/team-scope';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { z } from 'zod';

import { CitationText } from '@/components/chat/citation';
import { PageHeader } from '@/components/page-header';
import { RelativeTimestamp } from '@/components/relative-timestamp';
import { Button } from '@/components/ui/button';
import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { handoffBodySchema, resolveHandoffSources } from '@/lib/handoff-snapshot';

export default async function HandoffPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, session] = await Promise.all([params, auth()]);
  if (!session?.user) redirect('/sign-in');
  if (!z.uuid().safeParse(id).success) notFound();
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) redirect('/sign-in');
  const scope = withTeam(db, active.teamId, session.user.id);
  const row = await scope.handoffs.read(id);
  if (!row) notFound();
  const body = handoffBodySchema.safeParse(row.body);
  if (!body.success) notFound();
  const [project, sources, commitments] = await Promise.all([
    scope.objects.getObject(row.projectId),
    resolveHandoffSources(scope, body.data.sources),
    scope.objects.listObjects({ id: body.data.commitments.map((item) => item.id), limit: 100 }),
  ]);
  const visibleCommitments = new Set(commitments.map((item) => item.id));
  if (
    !project ||
    !sources ||
    body.data.commitments.some((item) => !visibleCommitments.has(item.id))
  )
    notFound();
  return (
    <article className="space-y-6">
      <PageHeader
        title={`${body.data.project} handoff`}
        subtitle="Saved project snapshot"
        metadata={[{ label: 'Saved', value: <RelativeTimestamp value={row.createdAt} /> }]}
        trailing={
          <Button asChild variant="outline">
            <Link href={`/app/objects/${row.projectId}`}>Open current project</Link>
          </Button>
        }
      />
      <section className="space-y-2">
        <h2 className="font-medium">Project answer</h2>
        <div className="whitespace-pre-wrap text-sm">
          <CitationText text={body.data.answer} numbers={numberCitations(body.data.answer)} />
        </div>
      </section>
      <section className="space-y-2">
        <h2 className="font-medium">Outstanding commitments</h2>
        {body.data.commitments.length ? (
          <ul className="divide-y rounded-lg border">
            {body.data.commitments.map((item) => (
              <li key={item.id} className="flex flex-wrap justify-between gap-2 p-3 text-sm">
                <Link href={`/app/objects/${item.id}`} className="underline">
                  {item.title}
                </Link>
                <span className="text-fg-muted">{item.owner ?? 'Unassigned'}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-fg-muted">No open commitments were recorded.</p>
        )}
      </section>
      <section className="space-y-2">
        <h2 className="font-medium">Sources</h2>
        <ul className="space-y-2 text-sm">
          {sources.map((source) => (
            <li key={artifactRefCitation(source.ref)}>
              {source.href && source.href.startsWith('/') && !source.href.startsWith('//') ? (
                <Link href={source.href} className="underline">
                  {source.title}
                </Link>
              ) : (
                source.title
              )}
            </li>
          ))}
        </ul>
      </section>
    </article>
  );
}
