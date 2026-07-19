import { withTeam } from '@timeline/shared/team-scope';
import { redirect } from 'next/navigation';

import type { Metadata } from 'next';

import { HistoryBackLink } from '@/components/history-back-link';
import { NewObjectForm } from '@/components/objects/new-object-form';
import { PageHeader } from '@/components/page-header';
import { WorkSubnav } from '@/components/work-subnav';
import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { loadProjectFilterRows } from '@/lib/project-filter-options';

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
  const projectParam = Array.isArray(query.project) ? query.project[0] : query.project;
  const projects = await loadProjectFilterRows({
    listObjects: (filter) => scope.objects.listObjects(filter),
    selected: projectParam ?? '',
  });
  const returnToParam = Array.isArray(query.returnTo) ? query.returnTo[0] : query.returnTo;
  const defaultProjectId =
    projectParam &&
    UUID_RE.test(projectParam) &&
    projects.some((project) => project.id === projectParam)
      ? projectParam
      : '';
  const returnTo = returnToParam?.startsWith('/app/') ? returnToParam : undefined;
  return (
    <div className="space-y-6">
      <PageHeader
        title="New object"
        subtitle="Create a tracked object for your team."
        leading={objectsBackLink}
      />
      <WorkSubnav current="/app/objects/new" />
      <NewObjectForm
        projects={projects.map((project) => ({ id: project.id, label: project.canonicalName }))}
        defaultProjectId={defaultProjectId}
        {...(returnTo ? { returnTo } : {})}
      />
    </div>
  );
}
