import { withTeam } from '@timeline/shared';
import { notFound, redirect } from 'next/navigation';

import { DocumentDetail } from '@/components/documents/document-detail';
import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Props {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ version?: string }>;
}

export default async function DocumentDetailPage({ params, searchParams }: Props) {
  const session = await auth();
  if (!session?.user) redirect('/sign-in');
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) redirect('/sign-in');

  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const sp = await searchParams;

  const scope = withTeam(db, active.teamId, session.user.id);
  await scope.requireMembership();

  const document = await scope.documents.getDocument(id);
  if (!document) notFound();

  const [versions, folderPath] = await Promise.all([
    scope.documents.listDocumentVersions(document.id),
    scope.documents.folderPath(document.folderId),
  ]);
  const requestedVersion = sp.version ? Number.parseInt(sp.version, 10) : null;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <DocumentDetail
        document={{
          id: document.id,
          name: document.name,
          folderId: document.folderId,
          folderPath,
          visibility: document.visibility,
          ownerUserId: document.ownerUserId,
          currentVersionId: document.currentVersionId,
          createdAt: document.createdAt.toISOString(),
          updatedAt: document.updatedAt.toISOString(),
        }}
        versions={versions.map((v) => ({
          id: v.id,
          version: v.version,
          byteSize: v.byteSize,
          contentType: v.contentType,
          processingStatus: v.processingStatus,
          processingError: v.processingError,
          createdAt: v.createdAt.toISOString(),
          uploadedByUserId: v.uploadedByUserId,
        }))}
        requestedVersion={requestedVersion}
      />
    </div>
  );
}
