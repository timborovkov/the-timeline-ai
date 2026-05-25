import { withTeam } from '@timeline/shared';
import { redirect } from 'next/navigation';

import { DocumentDrive } from '@/components/documents/document-drive';
import { NarrowContainer } from '@/components/narrow-container';
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

  const currentFolder = folderParam ? await scope.getFolder(folderParam) : null;
  // Defense in depth: an unknown / invisible folder id silently falls back
  // to root rather than rendering a "Folder not found" page that leaks
  // the existence-or-not distinction.
  const folderId = currentFolder?.id ?? null;
  const [folders, documents, breadcrumbs] = await Promise.all([
    scope.listFolders({ parentFolderId: folderId }),
    scope.listDocuments({ folderId }),
    breadcrumbsFor(scope, folderId),
  ]);

  return (
    <NarrowContainer>
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
    </NarrowContainer>
  );
}

async function breadcrumbsFor(
  scope: ReturnType<typeof withTeam>,
  folderId: string | null,
): Promise<{ id: string | null; name: string }[]> {
  const crumbs: { id: string | null; name: string }[] = [{ id: null, name: 'Documents' }];
  if (!folderId) return crumbs;
  let cursor: string | null = folderId;
  const chain: { id: string; name: string }[] = [];
  // Bounded walk — same defense the scope.folderPath helper uses.
  for (let i = 0; i < 32; i++) {
    if (!cursor) break;
    const folder = await scope.getFolder(cursor);
    if (!folder) break;
    chain.unshift({ id: folder.id, name: folder.name });
    cursor = folder.parentFolderId;
  }
  for (const c of chain) crumbs.push(c);
  return crumbs;
}
