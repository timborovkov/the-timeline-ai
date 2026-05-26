import { withTeam } from '@timeline/shared';
import { redirect } from 'next/navigation';

import { DocumentDrive } from '@/components/documents/document-drive';
import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Props {
  searchParams: Promise<{ folder?: string }>;
}

export default async function DocumentsPage({ searchParams }: Props) {
  const session = await auth();
  if (!session?.user) redirect('/sign-in');
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) redirect('/sign-in');

  const sp = await searchParams;
  const folderParam = sp.folder && UUID_RE.test(sp.folder) ? sp.folder : null;

  const scope = withTeam(db, active.teamId, session.user.id);
  await scope.requireMembership();

  const currentFolder = folderParam ? await scope.documents.getFolder(folderParam) : null;
  // Defense in depth: an unknown / invisible folder id silently falls back
  // to root rather than rendering a "Folder not found" page that leaks
  // the existence-or-not distinction.
  const folderId = currentFolder?.id ?? null;
  const [folders, documents, ancestry] = await Promise.all([
    scope.documents.listFolders({ parentFolderId: folderId }),
    scope.documents.listDocuments({ folderId }),
    scope.documents.folderAncestry(folderId),
  ]);
  // Prepend the root crumb. Scope returns ancestors only — the root
  // label is a UI concern, not data.
  const breadcrumbs: { id: string | null; name: string }[] = [
    { id: null, name: 'Documents' },
    ...ancestry,
  ];

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <DocumentDrive
        currentFolderId={folderId}
        breadcrumbs={breadcrumbs}
        folders={folders.map((f) => ({
          id: f.id,
          name: f.name,
          visibility: f.visibility,
          updatedAt: f.updatedAt.toISOString(),
        }))}
        documents={documents.map((d) => ({
          id: d.id,
          name: d.name,
          visibility: d.visibility,
          updatedAt: d.updatedAt.toISOString(),
          ownerUserId: d.ownerUserId,
        }))}
      />
    </div>
  );
}
