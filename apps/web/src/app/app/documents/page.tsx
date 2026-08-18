import { users } from '@timeline/db';
import { withTeam } from '@timeline/shared/team-scope';
import { inArray } from 'drizzle-orm';
import { redirect } from 'next/navigation';

import type { Metadata } from 'next';

import { ChatViewContextBinder } from '@/components/chat/chat-view-context';
import { DocumentDrive } from '@/components/documents/document-drive';
import { DocumentSearch } from '@/components/documents/document-search';
import { PageHeader } from '@/components/page-header';
import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { displayMemberLabel } from '@/lib/display-labels';

export const metadata: Metadata = {
  title: 'Documents',
  description: 'Browse team documents and folders.',
};

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
  const [folders, documentPage, ancestry, defaults, members] = await Promise.all([
    scope.documents.listFolders({ parentFolderId: folderId }),
    scope.documents.listDocumentsWithProvenancePage({ folderId, limit: 30 }),
    scope.documents.folderAncestry(folderId),
    scope.timeline.resolveVisibilityDefault('document'),
    scope.timeline.listMembers(),
  ]);
  const documentPinState = await scope.pins.isPinnedMany(
    documentPage.items.map((document) => ({ kind: 'document' as const, key: document.id })),
  );
  const memberIds = members.map((m) => m.userId);
  const memberUsers =
    memberIds.length > 0
      ? await db
          .select({ id: users.id, name: users.name, email: users.email })
          .from(users)
          .where(inArray(users.id, memberIds))
      : [];
  const memberUserMap = new Map(memberUsers.map((u) => [u.id, u] as const));
  // Prepend the root crumb. Scope returns ancestors only — the root
  // label is a UI concern, not data.
  const breadcrumbs: { id: string | null; name: string }[] = [
    { id: null, name: 'Documents' },
    ...ancestry,
  ];

  return (
    <div className="space-y-6">
      {currentFolder ? (
        <ChatViewContextBinder
          viewKey={`documents-folder:${currentFolder.id}`}
          kind="page"
          href={`/app/documents?folder=${currentFolder.id}`}
          label={currentFolder.name}
        />
      ) : null}
      <PageHeader
        variant="collection"
        title="Documents"
        subtitle="Browse files, folders, and captured knowledge."
      />
      <DocumentSearch />
      <DocumentDrive
        key={folderId ?? 'root'}
        currentFolderId={folderId}
        breadcrumbs={breadcrumbs}
        defaultVisibility={defaults.visibility}
        defaultVisibilityUserIds={defaults.visibilityUserIds}
        members={members.map((m) => {
          const u = memberUserMap.get(m.userId);
          return { id: m.userId, label: displayMemberLabel(u) };
        })}
        folders={folders.map((f) => ({
          id: f.id,
          name: f.name,
          visibility: f.visibility,
          updatedAt: f.updatedAt.toISOString(),
        }))}
        documents={documentPage.items.map((d) => ({
          id: d.id,
          fileKind: d.fileKind,
          name: d.name,
          metadata: d.metadata,
          visibility: d.visibility,
          updatedAt: d.updatedAt.toISOString(),
          ownerUserId: d.ownerUserId,
          pinned: documentPinState[`document:${d.id}`] ?? false,
          currentVersion: d.currentVersion
            ? {
                ...d.currentVersion,
                createdAt: d.currentVersion.createdAt.toISOString(),
              }
            : null,
          provenance: {
            source: d.provenance.source,
            sourceEventId: d.provenance.sourceEventId,
            parentEventId: d.provenance.parentEventId,
            occurredAt: d.provenance.occurredAt?.toISOString() ?? null,
            summary: d.provenance.summary,
          },
          description: d.description,
          presentation: d.presentation,
        }))}
        documentsNextCursor={documentPage.nextCursor}
      />
    </div>
  );
}
