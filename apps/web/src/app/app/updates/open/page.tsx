import { notFound, redirect } from 'next/navigation';

import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { updateDestinationPath } from '@/lib/update-links';

export default async function OpenUpdateLink({
  searchParams,
}: {
  searchParams: Promise<{ team?: string; to?: string }>;
}) {
  const query = await searchParams;
  const path = updateDestinationPath(query.to);
  if (!path || typeof query.team !== 'string') notFound();

  const session = await auth();
  if (!session?.user) {
    const callback = `/app/updates/open?${new URLSearchParams({ team: query.team, to: path })}`;
    redirect(`/sign-in?callbackUrl=${encodeURIComponent(callback)}`);
  }
  const { active, memberships } = await resolveActiveTeam(session.user.id);
  if (active?.teamId === query.team) redirect(path);
  const workspace = memberships.find((member) => member.teamId === query.team);
  if (!workspace) notFound();

  const target = `/app/team/switch/${workspace.teamId}?${new URLSearchParams({ update: path })}`;
  return (
    <div data-app-width="collection" className="max-w-xl space-y-4">
      <PageHeader
        title={`Open in ${workspace.teamName}`}
        subtitle="Switch workspaces to view this item."
      />
      <form action={target} method="post">
        <Button type="submit">Switch and open</Button>
      </form>
    </div>
  );
}
