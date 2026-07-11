import { withTeam } from '@timeline/shared/team-scope';
import { redirect } from 'next/navigation';

import type { Metadata } from 'next';

import { HistoryBackLink } from '@/components/history-back-link';
import { IndexStrip } from '@/components/index-strip';
import { NewObjectForm } from '@/components/objects/new-object-form';
import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';

export const metadata: Metadata = {
  title: 'New object',
  description: 'Create a tracked timeline object.',
};

const objectsBackLink = <HistoryBackLink fallbackHref="/app/objects" label="Back" />;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMPTY_SEARCH_PARAMS: Record<string, string | string[] | undefined> = {};

export default async function NewObjectPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [session, query] = await Promise.all([
    auth(),
    searchParams ?? Promise.resolve(EMPTY_SEARCH_PARAMS),
  ]);
  if (!session?.user) redirect('/sign-in');
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) redirect('/sign-in');
  const scope = withTeam(db, active.teamId, session.user.id);
  const projects = await scope.objects.listObjects({
    type: 'project',
    archived: false,
    limit: 200,
  });
  const projectParam = Array.isArray(query.project) ? query.project[0] : query.project;
  const returnToParam = Array.isArray(query.returnTo) ? query.returnTo[0] : query.returnTo;
  const defaultProjectId =
    projectParam &&
    UUID_RE.test(projectParam) &&
    projects.some((project) => project.id === projectParam)
      ? projectParam
      : '';
  const returnTo = returnToParam?.startsWith('/app/') ? returnToParam : undefined;
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <IndexStrip
        srLabel="Create a new workspace object"
        segments={[{ value: 'OBJECTS / NEW' }, { label: 'mode', value: 'create', signal: true }]}
        leading={objectsBackLink}
      />
      <NewObjectForm
        projects={projects.map((project) => ({ id: project.id, label: project.canonicalName }))}
        defaultProjectId={defaultProjectId}
        {...(returnTo ? { returnTo } : {})}
      />
    </div>
  );
}
