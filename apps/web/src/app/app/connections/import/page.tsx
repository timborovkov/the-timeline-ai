import { withTeam } from '@timeline/shared/team-scope';
import { redirect } from 'next/navigation';

import { ImportForm } from '@/app/app/connections/import/import-form';
import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';

export default async function ImportPage({
  searchParams,
}: {
  searchParams: Promise<{ provider?: string }>;
}) {
  const [session, { provider }] = await Promise.all([auth(), searchParams]);
  if (!session?.user.id) redirect('/sign-in');
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) redirect('/sign-in');
  const scope = withTeam(db, active.teamId, session.user.id);
  const role = await scope.requireMembership();
  if (role !== 'owner' && role !== 'admin') redirect('/app/connections/sources');
  const options = await scope.boardImports.options();
  return (
    <section className="mx-auto max-w-3xl space-y-5 px-4 py-8">
      <h1 className="text-2xl font-semibold">Import and keep in sync</h1>
      <ImportForm
        sources={options.sources.filter((s) => !provider || s.provider === provider)}
        boards={options.boards.map((b) => ({ id: b.id, name: b.name }))}
        projects={options.projects}
      />
    </section>
  );
}
