import { withTeam } from '@timeline/shared/team-scope';
import { notFound, redirect } from 'next/navigation';

import type { Metadata } from 'next';

import { DocumentDetail } from '@/components/documents/document-detail';
import { PinButton } from '@/components/pins/pin-button';
import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { documentDetailProvenance } from '@/lib/document-detail-provenance';

export const metadata: Metadata = {
  title: 'Document',
  description: 'Review a document and extracted timeline context.',
};

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

  const [versions, folderPath, provenancePage, initialPinned] = await Promise.all([
    scope.documents.listDocumentVersions(document.id),
    scope.documents.folderPath(document.folderId),
    scope.documents.listDocumentsWithProvenancePage({
      documentId: document.id,
      fileKind: document.fileKind,
      limit: 1,
    }),
    scope.pins.isPinned({ kind: 'document', key: document.id }),
  ]);
  const listEntry = provenancePage.items[0] ?? null;
  const provenance = documentDetailProvenance(document, listEntry);
  const requestedVersion = sp.version ? Number.parseInt(sp.version, 10) : null;
  const selectedVersion =
    requestedVersion && Number.isFinite(requestedVersion)
      ? (versions.find((version) => version.version === requestedVersion) ?? null)
      : null;
  const activeVersion =
    selectedVersion ??
    versions.find((version) => version.id === document.currentVersionId) ??
    versions[0] ??
    null;
  const activeVersionChunks = activeVersion
    ? await scope.documents.listDocumentVersionChunks(activeVersion.id)
    : [];

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <PinButton target={{ kind: 'document', key: document.id }} initialPinned={initialPinned} />
      </div>
      <DocumentDetail
        document={{
          id: document.id,
          fileKind: document.fileKind,
          name: document.name,
          metadata: document.metadata,
          folderId: document.folderId,
          folderPath,
          visibility: document.visibility,
          ownerUserId: document.ownerUserId,
          currentVersionId: document.currentVersionId,
          sourceRawEventId: document.sourceRawEventId,
          createdAt: document.createdAt.toISOString(),
          updatedAt: document.updatedAt.toISOString(),
          provenance,
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
        activeVersionId={activeVersion?.id ?? null}
        activeVersionChunks={activeVersionChunks.map((chunk) => ({
          id: chunk.id,
          representationKind: chunk.representationKind,
          text: chunk.text,
          summary: chunk.summary,
          pageNumber: chunk.pageNumber,
        }))}
      />
    </div>
  );
}
