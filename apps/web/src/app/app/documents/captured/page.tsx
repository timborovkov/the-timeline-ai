import { users } from '@timeline/db';
import { withTeam } from '@timeline/shared/team-scope';
import { inArray } from 'drizzle-orm';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import type { Metadata } from 'next';

import { CapturedFilesList } from '@/components/captured-files/captured-files-list';
import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';

export const metadata: Metadata = {
  title: 'Captured files',
  description: 'Review captured source files before promotion.',
};

export default async function CapturedFilesPage() {
  const session = await auth();
  if (!session?.user) redirect('/sign-in');
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) redirect('/sign-in');

  const scope = withTeam(db, active.teamId, session.user.id);
  await scope.requireMembership();
  const page = await scope.documents.listCapturedFilesPage({ limit: 50 });
  const ownerIds = [
    ...new Set(
      page.items.map((file) => file.ownerUserId).filter((id): id is string => Boolean(id)),
    ),
  ];
  const ownerRows =
    ownerIds.length > 0
      ? await db
          .select({ id: users.id, name: users.name, email: users.email })
          .from(users)
          .where(inArray(users.id, ownerIds))
      : [];
  const ownerMap = new Map(ownerRows.map((owner) => [owner.id, owner] as const));

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold text-foreground">Captured files</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Source attachments stay here until someone promotes them into the document drive.
          </p>
        </div>
        <Link
          href="/app/documents"
          className="inline-flex h-9 items-center rounded-sm border border-border px-3 font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground"
        >
          Documents
        </Link>
      </header>
      <CapturedFilesList
        files={page.items.map((file) => {
          const owner = file.ownerUserId ? ownerMap.get(file.ownerUserId) : null;
          return {
            id: file.id,
            name: file.name,
            visibility: file.visibility,
            updatedAt: file.updatedAt.toISOString(),
            ownerUserId: file.ownerUserId,
            ownerLabel: owner?.name ?? owner?.email ?? null,
            sourceRawEventId: file.sourceRawEventId,
            currentVersion: file.currentVersion
              ? {
                  contentType: file.currentVersion.contentType,
                  byteSize: file.currentVersion.byteSize,
                  processingStatus: file.currentVersion.processingStatus,
                }
              : null,
            provenance: {
              source: file.provenance.source,
              parentEventId: file.provenance.parentEventId,
              occurredAt: file.provenance.occurredAt?.toISOString() ?? null,
              summary: file.provenance.summary,
            },
          };
        })}
      />
    </div>
  );
}
