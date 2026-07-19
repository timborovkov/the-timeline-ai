import { users } from '@timeline/db';
import { withTeam } from '@timeline/shared/team-scope';
import { inArray } from 'drizzle-orm';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import type { Metadata } from 'next';

import { CapturedFilesList } from '@/components/captured-files/captured-files-list';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { displayMemberLabel } from '@/lib/display-labels';

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
  const [page, folders, members] = await Promise.all([
    scope.documents.listCapturedFilesPage({ limit: 50 }),
    scope.documents.listFolders({ parentFolderId: null }),
    scope.timeline.listMembers(),
  ]);
  const ownerIds = [
    ...new Set(
      page.items.map((file) => file.ownerUserId).filter((id): id is string => Boolean(id)),
    ),
  ];
  const memberIds = [...new Set([...ownerIds, ...members.map((member) => member.userId)])];
  const ownerRows =
    memberIds.length > 0
      ? await db
          .select({ id: users.id, name: users.name, email: users.email })
          .from(users)
          .where(inArray(users.id, memberIds))
      : [];
  const ownerMap = new Map(ownerRows.map((owner) => [owner.id, owner] as const));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <PageHeader
          title="Captured files"
          subtitle="Source attachments stay here until someone promotes them into the document drive."
        />
        <Button asChild variant="outline">
          <Link href="/app/documents">Documents</Link>
        </Button>
      </div>
      <CapturedFilesList
        folders={folders.map((folder) => ({ id: folder.id, name: folder.name }))}
        members={members.map((member) => {
          const user = ownerMap.get(member.userId);
          return { id: member.userId, label: displayMemberLabel(user) };
        })}
        files={page.items.map((file) => {
          const owner = file.ownerUserId ? ownerMap.get(file.ownerUserId) : null;
          return {
            id: file.id,
            name: file.name,
            metadata: file.metadata,
            visibility: file.visibility,
            visibilityUserIds: file.visibilityUserIds,
            updatedAt: file.updatedAt.toISOString(),
            ownerUserId: file.ownerUserId,
            ownerLabel: owner?.name ?? owner?.email ?? null,
            sourceRawEventId: file.sourceRawEventId,
            currentVersion: file.currentVersion
              ? {
                  id: file.currentVersion.id,
                  version: file.currentVersion.version,
                  contentType: file.currentVersion.contentType,
                  byteSize: file.currentVersion.byteSize,
                  processingStatus: file.currentVersion.processingStatus,
                  createdAt: file.currentVersion.createdAt.toISOString(),
                }
              : null,
            provenance: {
              source: file.provenance.source,
              parentEventId: file.provenance.parentEventId,
              occurredAt: file.provenance.occurredAt?.toISOString() ?? null,
              summary: file.provenance.summary,
            },
            description: file.description,
            presentation: file.presentation,
          };
        })}
        nextCursor={page.nextCursor}
      />
    </div>
  );
}
