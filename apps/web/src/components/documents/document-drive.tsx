'use client';

import { type InfiniteData, useQueryClient } from '@tanstack/react-query';
import { Folder as FolderIcon, FolderPlus, Upload } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  type ChangeEvent,
  type Dispatch,
  type DragEvent,
  type RefObject,
  type SetStateAction,
  useMemo,
  useRef,
  useState,
  useTransition,
} from 'react';
import { toast } from 'sonner';

import {
  createFolderAction,
  deleteFolderAction,
  finalizeDocumentVersionAction,
  requestDocumentUploadAction,
} from '@/app/actions/documents';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { queryKeys } from '@/lib/query-keys';
import { type DocumentListPage, useDocumentListQuery } from '@/lib/use-paginated-queries';

interface FolderItem {
  id: string;
  name: string;
  visibility: string;
  updatedAt: string;
}

interface DocumentItem {
  id: string;
  name: string;
  visibility: string;
  updatedAt: string;
  ownerUserId: string | null;
  optimistic?: boolean;
}

interface Crumb {
  id: string | null;
  name: string;
}

interface Props {
  currentFolderId: string | null;
  breadcrumbs: Crumb[];
  folders: FolderItem[];
  documents: DocumentItem[];
  documentsNextCursor: string | null;
  defaultVisibility: 'team' | 'private' | 'specific_users';
  defaultVisibilityUserIds: string[] | null;
  members: { id: string; label: string }[];
}

type UploadPhase = 'preparing' | 'uploading' | 'finalizing' | 'failed';

interface UploadState {
  id: string;
  name: string;
  phase: UploadPhase;
  error?: string;
}

function uploadStateId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function uploadPhaseLabel(upload: UploadState): string {
  if (upload.phase === 'failed') return upload.error ? `Failed: ${upload.error}` : 'Failed';
  if (upload.phase === 'preparing') return 'Preparing upload';
  if (upload.phase === 'uploading') return 'Uploading';
  return 'Finishing';
}

export function DocumentDrive({
  currentFolderId,
  breadcrumbs,
  folders,
  documents,
  documentsNextCursor,
  defaultVisibility,
  defaultVisibilityUserIds,
  members,
}: Props) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  const [uploads, setUploads] = useState<readonly UploadState[]>([]);
  const [visibility, setVisibility] = useState<'team' | 'private' | 'specific_users'>(
    defaultVisibility,
  );
  const [visibilityUserIds, setVisibilityUserIds] = useState<string[]>(
    defaultVisibilityUserIds ?? [],
  );
  const initialDocumentPage = useMemo(
    () => ({ items: documents, nextCursor: documentsNextCursor }),
    [documents, documentsNextCursor],
  );
  const documentQuery = useDocumentListQuery(currentFolderId, initialDocumentPage);
  const visibleDocuments = documentQuery.data.pages.flatMap((page) => page.items);
  const activeUploads = uploads.filter((upload) => upload.phase !== 'failed');
  const activeUpload = activeUploads[0];
  const uploadButtonLabel =
    activeUploads.length === 0
      ? 'Upload'
      : activeUploads.length === 1
        ? `${activeUpload ? uploadPhaseLabel(activeUpload) : 'Uploading'}...`
        : `Uploading ${String(activeUploads.length)} files...`;

  function updateUpload(id: string, patch: Partial<UploadState>): void {
    setUploads((prev) =>
      prev.map((upload) => (upload.id === id ? { ...upload, ...patch } : upload)),
    );
  }

  function clearUpload(id: string): void {
    setUploads((prev) => prev.filter((upload) => upload.id !== id));
  }

  function failUpload(id: string, message: string): void {
    updateUpload(id, { phase: 'failed', error: message });
    window.setTimeout(() => {
      clearUpload(id);
    }, 8000);
  }

  function addOptimisticDocument(document: DocumentItem): void {
    queryClient.setQueryData<InfiniteData<DocumentListPage, string | null> | undefined>(
      queryKeys.documentList(currentFolderId),
      (previous) => {
        if (!previous?.pages[0]) return previous;
        const first = previous.pages[0];
        if (first.items.some((item) => item.id === document.id)) return previous;
        return {
          ...previous,
          pages: [{ ...first, items: [document, ...first.items] }, ...previous.pages.slice(1)],
        };
      },
    );
  }

  function removeOptimisticDocument(documentId: string): void {
    queryClient.setQueryData<InfiniteData<DocumentListPage, string | null> | undefined>(
      queryKeys.documentList(currentFolderId),
      (previous) => {
        if (!previous) return previous;
        return {
          ...previous,
          pages: previous.pages.map((page) => ({
            ...page,
            items: page.items.filter((item) => item.id !== documentId || !item.optimistic),
          })),
        };
      },
    );
  }

  async function handleUploadFile(file: File): Promise<void> {
    const uploadId = uploadStateId();
    setUploads((prev) => [...prev, { id: uploadId, name: file.name, phase: 'preparing' }]);
    let optimisticDocumentId: string | null = null;
    try {
      const req = await requestDocumentUploadAction({
        folderId: currentFolderId,
        name: file.name,
        filename: file.name,
        contentType: file.type || 'application/octet-stream',
        visibility,
        visibilityUserIds: visibility === 'specific_users' ? visibilityUserIds : [],
      });
      if (!req.ok || !req.url || !req.versionId) {
        const message = req.error ?? 'Upload failed';
        toast.error(message);
        failUpload(uploadId, message);
        return;
      }
      if (req.maxBytes && file.size > req.maxBytes) {
        const message = `File exceeds ${String(Math.round(req.maxBytes / 1024 / 1024))} MiB limit`;
        toast.error(message);
        failUpload(uploadId, message);
        return;
      }
      if (req.documentId) {
        optimisticDocumentId = req.documentId;
        addOptimisticDocument({
          id: req.documentId,
          name: file.name,
          visibility,
          updatedAt: new Date().toISOString(),
          ownerUserId: null,
          optimistic: true,
        });
      }
      updateUpload(uploadId, { phase: 'uploading' });
      const put = await fetch(req.url, {
        method: 'PUT',
        body: file,
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
      });
      if (!put.ok) {
        if (optimisticDocumentId) removeOptimisticDocument(optimisticDocumentId);
        const message = `Storage upload failed (${String(put.status)})`;
        toast.error(message);
        failUpload(uploadId, message);
        return;
      }
      updateUpload(uploadId, { phase: 'finalizing' });
      const fin = await finalizeDocumentVersionAction({ versionId: req.versionId });
      if (!fin.ok) {
        if (optimisticDocumentId) removeOptimisticDocument(optimisticDocumentId);
        const message = fin.error ?? 'Finalize failed';
        toast.error(message);
        failUpload(uploadId, message);
        return;
      }
      toast.success(`Uploaded ${file.name}`);
      clearUpload(uploadId);
      router.refresh();
    } catch (err) {
      if (optimisticDocumentId) removeOptimisticDocument(optimisticDocumentId);
      const message =
        err instanceof TypeError
          ? 'Browser could not reach document storage. Check S3_PUBLIC_ENDPOINT and RustFS CORS.'
          : err instanceof Error
            ? err.message
            : 'Upload error';
      toast.error(message);
      failUpload(uploadId, message);
    }
  }

  function onFileChange(e: ChangeEvent<HTMLInputElement>): void {
    const file = e.target.files?.[0];
    if (file) void handleUploadFile(file);
    e.target.value = '';
  }

  function onNewFolder(): void {
    const name = window.prompt('Folder name');
    if (!name?.trim()) return;
    startTransition(async () => {
      const res = await createFolderAction({
        name: name.trim(),
        parentFolderId: currentFolderId,
        visibility,
        visibilityUserIds: visibility === 'specific_users' ? visibilityUserIds : [],
      });
      if (!res.ok) toast.error(res.error ?? 'Failed to create folder');
      else router.refresh();
    });
  }

  function onDeleteFolder(id: string): void {
    if (!window.confirm('Delete folder? Documents inside stay where they are.')) return;
    startTransition(async () => {
      const res = await deleteFolderAction(id);
      if (!res.ok) toast.error(res.error ?? 'Delete failed');
      else router.refresh();
    });
  }

  function onDrop(e: DragEvent<HTMLDivElement>): void {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files);
    for (const file of files) void handleUploadFile(file);
  }

  return (
    <div className="space-y-6">
      <DocumentDriveHeader
        breadcrumbs={breadcrumbs}
        pending={pending}
        uploadButtonLabel={uploadButtonLabel}
        uploadDisabled={activeUploads.length > 0}
        fileInputRef={fileInputRef}
        onNewFolder={onNewFolder}
        onFileChange={onFileChange}
      />
      <UploadStatusList uploads={uploads} />
      <NewItemVisibilityPicker
        visibility={visibility}
        visibilityUserIds={visibilityUserIds}
        members={members}
        onVisibilityChange={setVisibility}
        onVisibilityUserIdsChange={setVisibilityUserIds}
      />
      <DocumentDropZone
        folders={folders}
        documents={visibleDocuments}
        query={documentQuery}
        fileInputRef={fileInputRef}
        onDrop={onDrop}
        onDeleteFolder={onDeleteFolder}
      />
    </div>
  );
}

function DocumentDriveHeader({
  breadcrumbs,
  pending,
  uploadButtonLabel,
  uploadDisabled,
  fileInputRef,
  onNewFolder,
  onFileChange,
}: {
  breadcrumbs: Crumb[];
  pending: boolean;
  uploadButtonLabel: string;
  uploadDisabled: boolean;
  fileInputRef: RefObject<HTMLInputElement | null>;
  onNewFolder: () => void;
  onFileChange: (e: ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-4">
      <Breadcrumbs breadcrumbs={breadcrumbs} />
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={onNewFolder} disabled={pending}>
          <FolderPlus className="mr-2 size-4" />
          New folder
        </Button>
        <Button size="sm" onClick={() => fileInputRef.current?.click()} disabled={uploadDisabled}>
          <Upload className="mr-2 size-4" />
          {uploadButtonLabel}
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          onChange={onFileChange}
          aria-label="Upload document"
        />
      </div>
    </header>
  );
}

function Breadcrumbs({ breadcrumbs }: { breadcrumbs: Crumb[] }) {
  return (
    <nav className="text-sm">
      {breadcrumbs.map((c, i) => (
        <span key={`${c.id ?? 'root'}-${String(i)}`}>
          {i > 0 && <span className="mx-1 text-muted-foreground">/</span>}
          {i === breadcrumbs.length - 1 ? (
            <span className="font-semibold text-foreground">{c.name}</span>
          ) : (
            <Link
              href={c.id ? `/app/documents?folder=${c.id}` : '/app/documents'}
              className="text-muted-foreground hover:text-foreground"
            >
              {c.name}
            </Link>
          )}
        </span>
      ))}
    </nav>
  );
}

function UploadStatusList({ uploads }: { uploads: readonly UploadState[] }) {
  if (uploads.length === 0) return null;
  return (
    <output className="space-y-2 rounded-sm border border-border bg-card/40 p-3" aria-live="polite">
      {uploads.map((upload) => (
        <div key={upload.id} className="flex items-center justify-between gap-3 text-sm">
          <span className="truncate font-medium">{upload.name}</span>
          <span
            className={
              upload.phase === 'failed'
                ? 'shrink-0 text-xs text-destructive'
                : 'shrink-0 text-xs text-muted-foreground'
            }
          >
            {uploadPhaseLabel(upload)}
          </span>
        </div>
      ))}
    </output>
  );
}

function NewItemVisibilityPicker({
  visibility,
  visibilityUserIds,
  members,
  onVisibilityChange,
  onVisibilityUserIdsChange,
}: {
  visibility: Props['defaultVisibility'];
  visibilityUserIds: string[];
  members: Props['members'];
  onVisibilityChange: (visibility: Props['defaultVisibility']) => void;
  onVisibilityUserIdsChange: Dispatch<SetStateAction<string[]>>;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-sm border border-border p-3 text-sm">
      <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-dim">
        New item visibility
      </span>
      <select
        aria-label="New item visibility"
        value={visibility}
        onChange={(e) => {
          onVisibilityChange(e.target.value as Props['defaultVisibility']);
        }}
        className="h-8 rounded-sm border border-border bg-bg px-2 text-sm"
      >
        <option value="team">Team</option>
        <option value="private">Private</option>
        <option value="specific_users">Specific users</option>
      </select>
      {visibility === 'specific_users'
        ? members.map((m) => (
            <label key={m.id} className="flex items-center gap-1 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={visibilityUserIds.includes(m.id)}
                onChange={(e) => {
                  onVisibilityUserIdsChange((prev) =>
                    e.target.checked
                      ? [...new Set([...prev, m.id])]
                      : prev.filter((id) => id !== m.id),
                  );
                }}
              />
              {m.label}
            </label>
          ))
        : null}
    </div>
  );
}

function DocumentDropZone({
  folders,
  documents,
  query,
  fileInputRef,
  onDrop,
  onDeleteFolder,
}: {
  folders: FolderItem[];
  documents: DocumentItem[];
  query: ReturnType<typeof useDocumentListQuery>;
  fileInputRef: RefObject<HTMLInputElement | null>;
  onDrop: (e: DragEvent<HTMLDivElement>) => void;
  onDeleteFolder: (id: string) => void;
}) {
  const isEmpty = folders.length === 0 && documents.length === 0;
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
      }}
      onDrop={onDrop}
      className="rounded-sm border border-dashed border-border bg-card/30 p-6"
    >
      {isEmpty ? (
        <EmptyDocumentDrive fileInputRef={fileInputRef} />
      ) : (
        <div className="space-y-6">
          <FolderList folders={folders} onDeleteFolder={onDeleteFolder} />
          <DocumentList documents={documents} query={query} />
        </div>
      )}
    </div>
  );
}

function EmptyDocumentDrive({
  fileInputRef,
}: {
  fileInputRef: RefObject<HTMLInputElement | null>;
}) {
  return (
    <div className="py-8 text-center">
      <p className="font-mono text-xs uppercase tracking-[0.12em] text-fg-dim">No documents yet</p>
      <p className="mx-auto mt-2 max-w-md text-sm text-fg-muted">
        Upload a document to make contracts, policies, notes, and customer files searchable and
        citeable.
      </p>
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        className="mt-4 inline-flex min-h-9 items-center rounded-sm border border-signal/40 bg-signal-soft px-3 font-mono text-[11px] uppercase tracking-[0.12em] text-signal transition-colors hover:bg-signal/20"
      >
        Upload first document
      </button>
    </div>
  );
}

function FolderList({
  folders,
  onDeleteFolder,
}: {
  folders: FolderItem[];
  onDeleteFolder: (id: string) => void;
}) {
  if (folders.length === 0) return null;
  return (
    <section>
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Folders
      </h2>
      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {folders.map((f) => (
          <li
            key={f.id}
            className="group flex items-center justify-between rounded-sm border border-border bg-card p-3 hover:border-fg/20"
          >
            <Link
              href={`/app/documents?folder=${f.id}`}
              className="flex items-center gap-2 text-sm font-medium"
            >
              <FolderIcon className="size-4 text-muted-foreground" />
              <span>{f.name}</span>
            </Link>
            <button
              type="button"
              onClick={() => {
                onDeleteFolder(f.id);
              }}
              className="text-xs text-muted-foreground opacity-0 transition group-hover:opacity-100 hover:text-foreground"
            >
              Delete
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function DocumentList({
  documents,
  query,
}: {
  documents: DocumentItem[];
  query: ReturnType<typeof useDocumentListQuery>;
}) {
  if (documents.length === 0) return null;
  return (
    <section>
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Documents
      </h2>
      <ul className="space-y-2">
        {documents.map((d) => (
          <DocumentListItem key={d.id} document={d} />
        ))}
      </ul>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="mt-3"
        disabled={!query.hasNextPage || query.isFetchingNextPage}
        onClick={() => {
          void query.fetchNextPage();
        }}
      >
        {query.isFetchingNextPage ? 'Loading...' : query.hasNextPage ? 'Load more' : 'End'}
      </Button>
    </section>
  );
}

function DocumentListItem({ document }: { document: DocumentItem }) {
  return (
    <li className="flex items-center justify-between rounded-sm border border-border bg-card p-3 hover:border-fg/20">
      {document.optimistic ? (
        <span className="flex items-center gap-3 text-sm">
          <span className="font-medium">{document.name}</span>
          <Badge variant="outline" className="text-[10px]">
            uploading
          </Badge>
          <VisibilityBadge visibility={document.visibility} />
        </span>
      ) : (
        <Link href={`/app/documents/${document.id}`} className="flex items-center gap-3 text-sm">
          <span className="font-medium">{document.name}</span>
          <VisibilityBadge visibility={document.visibility} />
        </Link>
      )}
      <span className="text-xs text-muted-foreground">
        {new Date(document.updatedAt).toLocaleDateString()}
      </span>
    </li>
  );
}

function VisibilityBadge({ visibility }: { visibility: string }) {
  if (visibility === 'team') return null;
  return (
    <Badge variant="outline" className="text-[10px]">
      {visibility}
    </Badge>
  );
}
