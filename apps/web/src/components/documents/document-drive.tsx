'use client';

import { type InfiniteData, useQueryClient } from '@tanstack/react-query';
import {
  documentPresentation,
  truncateFilenameMiddle,
} from '@timeline/shared/documents/presentation';
import {
  Clock3,
  FileText,
  Folder as FolderIcon,
  FolderPlus,
  HardDrive,
  Image as ImageIcon,
  Link2,
  MessageCircle,
  Upload,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  type ChangeEvent,
  type Dispatch,
  type DragEvent,
  type RefObject,
  type SetStateAction,
  useId,
  useMemo,
  useReducer,
  useRef,
  useTransition,
} from 'react';

import {
  createFolderAction,
  deleteFolderAction,
  finalizeDocumentVersionAction,
  requestDocumentUploadAction,
} from '@/app/actions/documents';
import { CollectionGroup } from '@/components/collections/collection-group';
import { CollectionRow } from '@/components/collections/collection-row';
import { EvidenceLink } from '@/components/evidence-link';
import { PinOverflowMenu } from '@/components/pins/pin-overflow-menu';
import { useAppDialog } from '@/components/ui/app-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ItemActionGroup } from '@/components/ui/item-actions';
import { notifyAction } from '@/lib/notify';
import { queryKeys } from '@/lib/query-keys';
import { type DocumentListPage, useDocumentListQuery } from '@/lib/use-paginated-queries';

const LIST_DATE_FORMATTER = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });

interface FolderItem {
  id: string;
  name: string;
  visibility: string;
  updatedAt: string;
  optimistic?: boolean;
}

interface DocumentItem {
  id: string;
  fileKind: 'captured' | 'document';
  name: string;
  metadata: Record<string, unknown>;
  visibility: string;
  updatedAt: string;
  ownerUserId: string | null;
  pinned: boolean;
  currentVersion: {
    id: string;
    version: number;
    byteSize: number | null;
    contentType: string | null;
    processingStatus: string;
    sourceEventId: string | null;
    createdAt: string;
  } | null;
  provenance: {
    source: string;
    sourceEventId: string | null;
    parentEventId: string | null;
    occurredAt: string | null;
    summary: string | null;
  };
  description: string | null;
  presentation: {
    displayTitle: string;
    storedName: string;
    suggestedTitle: string | null;
    isGeneratedName: boolean;
    fallbackTitle: string;
  };
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

interface DriveUiState {
  uploads: readonly UploadState[];
  visibility: Props['defaultVisibility'];
  visibilityUserIds: string[];
  optimisticFolders: readonly FolderItem[];
  deletedFolderIds: ReadonlySet<string>;
}

type DriveUiAction =
  | { type: 'add-upload'; upload: UploadState }
  | { type: 'update-upload'; id: string; patch: Partial<UploadState> }
  | { type: 'clear-upload'; id: string }
  | { type: 'set-visibility'; visibility: Props['defaultVisibility'] }
  | { type: 'set-visibility-user-ids'; value: SetStateAction<string[]> }
  | { type: 'add-optimistic-folder'; folder: FolderItem }
  | { type: 'confirm-folder'; tempId: string; id: string }
  | { type: 'remove-optimistic-folder'; id: string }
  | { type: 'hide-folder'; id: string }
  | { type: 'restore-folder'; id: string };

function driveUiReducer(state: DriveUiState, action: DriveUiAction): DriveUiState {
  switch (action.type) {
    case 'add-upload':
      return { ...state, uploads: [...state.uploads, action.upload] };
    case 'update-upload':
      return {
        ...state,
        uploads: state.uploads.map((upload) =>
          upload.id === action.id ? { ...upload, ...action.patch } : upload,
        ),
      };
    case 'clear-upload':
      return { ...state, uploads: state.uploads.filter((upload) => upload.id !== action.id) };
    case 'set-visibility':
      return { ...state, visibility: action.visibility };
    case 'set-visibility-user-ids':
      return {
        ...state,
        visibilityUserIds:
          typeof action.value === 'function' ? action.value(state.visibilityUserIds) : action.value,
      };
    case 'add-optimistic-folder':
      return {
        ...state,
        optimisticFolders: [action.folder, ...state.optimisticFolders],
      };
    case 'confirm-folder':
      return {
        ...state,
        optimisticFolders: state.optimisticFolders.map((folder) =>
          folder.id === action.tempId ? { ...folder, id: action.id, optimistic: false } : folder,
        ),
      };
    case 'remove-optimistic-folder':
      return {
        ...state,
        optimisticFolders: state.optimisticFolders.filter((folder) => folder.id !== action.id),
      };
    case 'hide-folder':
      return {
        ...state,
        deletedFolderIds: new Set([...state.deletedFolderIds, action.id]),
        optimisticFolders: state.optimisticFolders.filter((folder) => folder.id !== action.id),
      };
    case 'restore-folder': {
      const deletedFolderIds = new Set(state.deletedFolderIds);
      deletedFolderIds.delete(action.id);
      return { ...state, deletedFolderIds };
    }
  }
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
  const dialog = useAppDialog();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  const [
    { uploads, visibility, visibilityUserIds, optimisticFolders, deletedFolderIds },
    dispatchDriveUi,
  ] = useReducer(driveUiReducer, {
    uploads: [],
    visibility: defaultVisibility,
    visibilityUserIds: defaultVisibilityUserIds ?? [],
    optimisticFolders: [],
    deletedFolderIds: new Set<string>(),
  });
  const initialDocumentPage = useMemo(
    () => ({ items: documents, nextCursor: documentsNextCursor }),
    [documents, documentsNextCursor],
  );
  const documentQuery = useDocumentListQuery(currentFolderId, initialDocumentPage);
  const visibleDocuments: DocumentItem[] = documentQuery.data.pages.flatMap((page) => page.items);
  const visibleFolders = useMemo(() => {
    const serverFolderIds = new Set(folders.map((folder) => folder.id));
    const activeOptimisticFolders = optimisticFolders.filter(
      (folder) => !serverFolderIds.has(folder.id),
    );
    const merged = [...activeOptimisticFolders, ...folders];
    const byId = new Map<string, FolderItem>();
    for (const folder of merged) {
      if (!deletedFolderIds.has(folder.id) && !byId.has(folder.id)) byId.set(folder.id, folder);
    }
    return Array.from(byId.values());
  }, [deletedFolderIds, folders, optimisticFolders]);
  const activeUploads = uploads.filter((upload) => upload.phase !== 'failed');
  const activeUpload = activeUploads[0];
  const uploadButtonLabel =
    activeUploads.length === 0
      ? 'Upload'
      : activeUploads.length === 1
        ? `${activeUpload ? uploadPhaseLabel(activeUpload) : 'Uploading'}...`
        : `Uploading ${String(activeUploads.length)} files...`;

  function updateUpload(id: string, patch: Partial<UploadState>): void {
    dispatchDriveUi({ type: 'update-upload', id, patch });
  }

  function clearUpload(id: string): void {
    dispatchDriveUi({ type: 'clear-upload', id });
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
    dispatchDriveUi({
      type: 'add-upload',
      upload: { id: uploadId, name: file.name, phase: 'preparing' },
    });
    let optimisticDocumentId: string | null = null;
    await notifyAction({
      id: `document:upload:${uploadId}`,
      loading: 'Uploading document…',
      success: `Uploaded ${file.name}`,
      error: 'Couldn’t upload document',
      run: async () => {
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
            const message = req.error ?? 'Couldn’t upload document';
            failUpload(uploadId, message);
            return { error: message };
          }
          if (req.maxBytes && file.size > req.maxBytes) {
            const message = `File exceeds ${String(Math.round(req.maxBytes / 1024 / 1024))} MiB limit`;
            failUpload(uploadId, message);
            return { error: message };
          }
          if (req.documentId) {
            optimisticDocumentId = req.documentId;
            addOptimisticDocument({
              id: req.documentId,
              fileKind: 'document',
              name: file.name,
              metadata: {},
              visibility,
              updatedAt: new Date().toISOString(),
              ownerUserId: null,
              pinned: false,
              currentVersion: null,
              provenance: {
                source: 'manual',
                sourceEventId: null,
                parentEventId: null,
                occurredAt: null,
                summary: null,
              },
              description: null,
              presentation: documentPresentation({
                name: file.name,
                contentType: file.type || 'application/octet-stream',
                metadata: {},
                fileKind: 'document',
              }),
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
            failUpload(uploadId, message);
            return { error: message };
          }
          updateUpload(uploadId, { phase: 'finalizing' });
          const fin = await finalizeDocumentVersionAction({ versionId: req.versionId });
          if (!fin.ok) {
            if (optimisticDocumentId) removeOptimisticDocument(optimisticDocumentId);
            const message = fin.error ?? 'Couldn’t finish upload';
            failUpload(uploadId, message);
            return { error: message };
          }
          clearUpload(uploadId);
          router.refresh();
          return {};
        } catch (err) {
          if (optimisticDocumentId) removeOptimisticDocument(optimisticDocumentId);
          const message =
            err instanceof TypeError
              ? 'Unable to reach document storage. Check your connection, then try again.'
              : err instanceof Error
                ? err.message
                : 'Couldn’t upload document';
          failUpload(uploadId, message);
          return { error: message };
        }
      },
    });
  }

  function onFileChange(e: ChangeEvent<HTMLInputElement>): void {
    const file = e.target.files?.[0];
    if (file) void handleUploadFile(file);
    e.target.value = '';
  }

  async function onNewFolder(): Promise<void> {
    const name = await dialog.input({
      title: 'New folder',
      description: 'Create a folder in the current location.',
      inputLabel: 'Folder name',
      confirmLabel: 'Create folder',
    });
    if (!name?.trim()) return;
    const trimmedName = name.trim();
    const tempId = `optimistic-folder-${uploadStateId()}`;
    const optimisticFolder: FolderItem = {
      id: tempId,
      name: trimmedName,
      visibility,
      updatedAt: new Date().toISOString(),
      optimistic: true,
    };
    dispatchDriveUi({ type: 'add-optimistic-folder', folder: optimisticFolder });
    startTransition(async () => {
      await notifyAction({
        id: `folder:create:${tempId}`,
        loading: 'Creating folder…',
        success: 'Folder created',
        error: 'Couldn’t create folder',
        run: async () => {
          const res = await createFolderAction({
            name: trimmedName,
            parentFolderId: currentFolderId,
            visibility,
            visibilityUserIds: visibility === 'specific_users' ? visibilityUserIds : [],
          });
          if (!res.ok) {
            dispatchDriveUi({ type: 'remove-optimistic-folder', id: tempId });
            return { error: res.error ?? 'Couldn’t create folder' };
          }
          const createdId = typeof res.id === 'string' ? res.id : null;
          if (createdId) {
            dispatchDriveUi({ type: 'confirm-folder', tempId, id: createdId });
          }
          router.refresh();
          return createdId ? { id: createdId } : {};
        },
        undo: {
          run: async (result) => {
            const createdId = 'id' in result && typeof result.id === 'string' ? result.id : null;
            if (!createdId) return { error: 'Couldn’t undo' };
            dispatchDriveUi({ type: 'hide-folder', id: createdId });
            const res = await deleteFolderAction(createdId);
            if (!res.ok) {
              dispatchDriveUi({ type: 'restore-folder', id: createdId });
              return { error: res.error ?? 'Couldn’t undo' };
            }
            router.refresh();
            return {};
          },
          success: 'Folder deleted',
        },
      });
    });
  }

  async function onDeleteFolder(id: string): Promise<void> {
    const confirmed = await dialog.confirm({
      title: 'Delete folder?',
      description: 'Documents inside stay where they are.',
      confirmLabel: 'Delete folder',
      destructive: true,
    });
    if (!confirmed) return;
    dispatchDriveUi({ type: 'hide-folder', id });
    startTransition(async () => {
      const result = await notifyAction({
        id: `folder:delete:${id}`,
        loading: 'Deleting folder…',
        success: 'Folder deleted',
        error: 'Couldn’t delete folder',
        run: async () => {
          const res = await deleteFolderAction(id);
          return res.ok ? {} : { error: res.error ?? 'Couldn’t delete folder' };
        },
      });
      if (result.error) dispatchDriveUi({ type: 'restore-folder', id });
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
        onVisibilityChange={(nextVisibility) => {
          dispatchDriveUi({ type: 'set-visibility', visibility: nextVisibility });
        }}
        onVisibilityUserIdsChange={(value) => {
          dispatchDriveUi({ type: 'set-visibility-user-ids', value });
        }}
      />
      <DocumentDropZone
        folders={visibleFolders}
        documents={visibleDocuments}
        query={documentQuery}
        fileInputRef={fileInputRef}
        onDrop={onDrop}
        onDeleteFolder={onDeleteFolder}
      />
      {dialog.node}
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
  onNewFolder: () => Promise<void>;
  onFileChange: (e: ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-4">
      <Breadcrumbs breadcrumbs={breadcrumbs} />
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button variant="outline" size="sm" asChild>
          <Link href="/app/documents/captured">
            <FileText className="mr-2 size-4" />
            Captured
          </Link>
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            void onNewFolder();
          }}
          disabled={pending}
        >
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
    <nav aria-label="Document location" className="text-sm">
      <ol className="flex flex-wrap items-center">
        {breadcrumbs.map((c, i) => (
          <li key={`${c.id ?? 'root'}-${String(i)}`} className="flex items-center">
            {i > 0 ? (
              <span aria-hidden="true" className="mx-1 text-muted-foreground">
                /
              </span>
            ) : null}
            {i === breadcrumbs.length - 1 ? (
              <span aria-current="page" className="font-semibold text-foreground">
                {c.name}
              </span>
            ) : (
              <Link
                href={c.id ? `/app/documents?folder=${c.id}` : '/app/documents'}
                className="rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                {c.name}
              </Link>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

function UploadStatusList({ uploads }: { uploads: readonly UploadState[] }) {
  if (uploads.length === 0) return null;
  return (
    <output className="space-y-2 rounded-lg border border-border bg-card/40 p-3" aria-live="polite">
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
  const visibilityId = useId();

  return (
    <fieldset className="flex flex-wrap items-center gap-3 rounded-lg border border-border p-3 text-sm">
      <legend className="px-1 text-xs text-fg-dim">New item visibility</legend>
      <label className="sr-only" htmlFor={visibilityId}>
        Default visibility for new documents and folders
      </label>
      <select
        id={visibilityId}
        value={visibility}
        onChange={(e) => {
          onVisibilityChange(e.target.value as Props['defaultVisibility']);
        }}
        className="h-8 rounded-sm border border-border bg-bg px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        <option value="team">Team</option>
        <option value="private">Private</option>
        <option value="specific_users">Specific users</option>
      </select>
      {visibility === 'specific_users' ? (
        <fieldset className="flex flex-wrap items-center gap-x-3 gap-y-2 border-l border-border pl-3">
          <legend className="sr-only">People with access</legend>
          {members.map((m, index) => {
            const memberId = `${visibilityId}-member-${String(index)}`;
            return (
              <label
                key={m.id}
                htmlFor={memberId}
                className="flex items-center gap-1.5 text-xs text-muted-foreground"
              >
                <input
                  id={memberId}
                  type="checkbox"
                  checked={visibilityUserIds.includes(m.id)}
                  onChange={(e) => {
                    onVisibilityUserIdsChange((prev) =>
                      e.target.checked
                        ? [...new Set([...prev, m.id])]
                        : prev.filter((id) => id !== m.id),
                    );
                  }}
                  className="size-4 rounded-sm border-input accent-signal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                />
                {m.label}
              </label>
            );
          })}
        </fieldset>
      ) : null}
    </fieldset>
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
  onDeleteFolder: (id: string) => Promise<void>;
}) {
  const isEmpty = folders.length === 0 && documents.length === 0;
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
      }}
      onDrop={onDrop}
      className="rounded-md border border-border bg-surface p-4"
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
      <p className="text-xs text-fg-dim">No documents yet</p>
      <p className="mx-auto mt-2 max-w-md text-sm text-fg-muted">
        Upload a document to make contracts, policies, notes, and customer files searchable and
        citeable.
      </p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => fileInputRef.current?.click()}
        className="mt-4"
      >
        Upload first document
      </Button>
    </div>
  );
}

function FolderList({
  folders,
  onDeleteFolder,
}: {
  folders: FolderItem[];
  onDeleteFolder: (id: string) => Promise<void>;
}) {
  if (folders.length === 0) return null;
  return (
    <CollectionGroup title="Folders" count={folders.length}>
      <ul className="border-x border-border">
        {folders.map((f) => (
          <li key={f.id}>
            <CollectionRow
              leading={<FolderIcon className="size-4 text-muted-foreground" aria-hidden />}
              title={
                f.optimistic ? (
                  <span className="opacity-70">{f.name}</span>
                ) : (
                  <Link
                    href={`/app/documents?folder=${f.id}`}
                    className="block truncate rounded-sm hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {f.name}
                  </Link>
                )
              }
              context={f.visibility}
              metadata={<time dateTime={f.updatedAt}>{formatDate(f.updatedAt)}</time>}
              actions={
                <ItemActionGroup label={`Actions for ${f.name}`}>
                  <Button
                    type="button"
                    onClick={() => {
                      void onDeleteFolder(f.id);
                    }}
                    disabled={f.optimistic}
                    variant="ghost"
                    size="sm"
                    aria-label={`Delete folder ${f.name}`}
                    className="min-h-10 px-2 text-fg-muted hover:text-fg"
                  >
                    Delete
                  </Button>
                </ItemActionGroup>
              }
            />
          </li>
        ))}
      </ul>
    </CollectionGroup>
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
    <CollectionGroup title="Documents" count={documents.length}>
      <ul className="border-x border-border">
        {documents.map((d) => (
          <DocumentListItem key={d.id} document={d} />
        ))}
      </ul>
      {query.hasNextPage || query.isFetchingNextPage ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-3"
          disabled={query.isFetchingNextPage}
          onClick={() => {
            void query.fetchNextPage();
          }}
        >
          {query.isFetchingNextPage ? 'Loading…' : 'Load more'}
        </Button>
      ) : null}
    </CollectionGroup>
  );
}

function DocumentListItem({ document }: { document: DocumentItem }) {
  const version = document.currentVersion;
  const sourceEventId = document.provenance.parentEventId ?? document.provenance.sourceEventId;
  const source = sourceDetails(document.provenance.source);
  const fileKind = fileKindDetails(document.name, version?.contentType ?? null);
  const presentation = document.presentation;
  const title = presentation.displayTitle;
  const usingFriendlyTitle = presentation.isGeneratedName && title !== document.name;
  const updatedAt = formatDate(document.updatedAt);
  const capturedAt = document.provenance.occurredAt
    ? formatDate(document.provenance.occurredAt)
    : null;
  const size = formatBytes(version?.byteSize ?? null);
  const status = version?.processingStatus ?? (document.optimistic ? 'uploading' : null);
  const metaItems = document.optimistic
    ? [
        { icon: source.icon, label: source.label },
        { icon: Clock3, label: 'Uploading now' },
      ]
    : [
        { icon: source.icon, label: source.label },
        capturedAt ? { icon: Clock3, label: capturedAt } : null,
        size ? { icon: HardDrive, label: size } : null,
        version ? { icon: FileText, label: `v${String(version.version)}` } : null,
      ];
  const summary = document.optimistic
    ? null
    : (document.description ??
      normalizeDocumentSummary(document.provenance.summary, document.name, title));

  return (
    <li style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 52px' }}>
      <CollectionRow
        className="min-h-13"
        title={
          <DocumentTitleRow
            document={document}
            fileKind={fileKind}
            title={title}
            storedName={usingFriendlyTitle ? truncateFilenameMiddle(document.name) : null}
            fullStoredName={usingFriendlyTitle ? document.name : null}
          />
        }
        context={summary ?? <DocumentMetaLine items={metaItems} />}
        metadata={
          <>
            <SourceBadge source={source} />
            <ProcessingBadge status={status} optimistic={document.optimistic === true} />
            <VisibilityBadge visibility={document.visibility} />
            <span className="hidden text-xs text-fg-dim sm:inline">{updatedAt}</span>
          </>
        }
        actions={
          <ItemActionGroup label={`Actions for ${title}`}>
            {sourceEventId ? (
              <EvidenceLink
                eventId={sourceEventId}
                previewText={summary}
                source={document.provenance.source}
                occurredAt={document.provenance.occurredAt}
                className="inline-flex h-8 items-center gap-1 rounded-sm border border-border px-2 text-xs text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground"
              >
                <Link2 className="size-3.5" />
                Event
              </EvidenceLink>
            ) : null}
            {!document.optimistic ? (
              <PinOverflowMenu
                target={{ kind: 'document', key: document.id }}
                title={title}
                initialPinned={document.pinned}
              />
            ) : null}
          </ItemActionGroup>
        }
      />
    </li>
  );
}

function DocumentTitleRow({
  document,
  fileKind,
  title,
  storedName,
  fullStoredName,
}: {
  document: DocumentItem;
  fileKind: { icon: LucideIcon; label: string };
  title: string;
  storedName: string | null;
  fullStoredName: string | null;
}) {
  const Icon = fileKind.icon;
  const content = (
    <>
      <span className="grid size-9 shrink-0 place-items-center rounded-sm border border-border bg-surface-2 text-muted-foreground">
        <Icon className="size-4" />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold text-foreground" title={title}>
          {title}
        </span>
        <span className="mt-0.5 flex min-w-0 items-center gap-2 text-xs text-fg-dim">
          <span className="shrink-0">{fileKind.label}</span>
          {storedName ? (
            <span
              className="min-w-0 truncate normal-case tracking-normal text-muted-foreground"
              title={fullStoredName ?? storedName}
            >
              Stored as {storedName}
            </span>
          ) : null}
        </span>
      </span>
    </>
  );
  if (document.optimistic) {
    return <div className="flex min-w-0 items-center gap-3">{content}</div>;
  }
  return (
    <Link
      href={`/app/documents/${document.id}`}
      className="flex min-w-0 items-center gap-3 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      {content}
    </Link>
  );
}

function DocumentMetaLine({ items }: { items: ({ icon: LucideIcon; label: string } | null)[] }) {
  const visibleItems = items.filter((item): item is { icon: LucideIcon; label: string } =>
    Boolean(item),
  );
  if (visibleItems.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
      {visibleItems.map((item) => {
        const Icon = item.icon;
        return (
          <span key={item.label} className="inline-flex min-w-0 items-center gap-1.5">
            <Icon className="size-3.5 shrink-0" />
            <span className="truncate">{item.label}</span>
          </span>
        );
      })}
    </div>
  );
}

function SourceBadge({
  source,
}: {
  source: { label: string; shortLabel: string; icon: LucideIcon };
}) {
  const Icon = source.icon;
  return (
    <Badge variant="secondary" className="gap-1 rounded-sm px-1.5 text-[11px]">
      <Icon className="size-3" />
      {source.shortLabel}
    </Badge>
  );
}

function ProcessingBadge({ status, optimistic }: { status: string | null; optimistic: boolean }) {
  if (!status || status === 'embedded') return null;
  const label = optimistic ? 'uploading' : status.replace(/_/g, ' ');
  return (
    <Badge variant="outline" className="rounded-sm text-[11px]">
      {label}
    </Badge>
  );
}

function VisibilityBadge({ visibility }: { visibility: string }) {
  if (visibility === 'team') return null;
  return (
    <Badge variant="outline" className="rounded-sm text-[11px]">
      {visibility}
    </Badge>
  );
}

function sourceDetails(source: string): {
  label: string;
  shortLabel: string;
  icon: LucideIcon;
} {
  if (source === 'telegram') {
    return { label: 'Telegram capture', shortLabel: 'Telegram', icon: MessageCircle };
  }
  if (source === 'slack') {
    return { label: 'Slack capture', shortLabel: 'Slack', icon: MessageCircle };
  }
  if (source === 'google_drive') {
    return { label: 'Google Drive sync', shortLabel: 'Drive', icon: HardDrive };
  }
  if (source === 'github') {
    return { label: 'GitHub sync', shortLabel: 'GitHub', icon: Link2 };
  }
  if (source === 'linear') {
    return { label: 'Linear sync', shortLabel: 'Linear', icon: Link2 };
  }
  return { label: 'Manual upload', shortLabel: 'Manual', icon: Upload };
}

function fileKindDetails(
  name: string,
  contentType: string | null,
): { icon: LucideIcon; label: string } {
  const lowerName = name.toLowerCase();
  if (contentType?.startsWith('image/') || /\.(png|jpe?g|gif|webp|heic|avif)$/.test(lowerName)) {
    return { icon: ImageIcon, label: contentType ?? 'image' };
  }
  if (contentType === 'application/pdf' || lowerName.endsWith('.pdf')) {
    return { icon: FileText, label: 'PDF' };
  }
  return { icon: FileText, label: contentType ?? 'document' };
}

function normalizeDocumentSummary(
  summary: string | null,
  storedName: string,
  title: string,
): string | null {
  if (!summary) return null;
  const trimmed = summary.trim();
  if (!trimmed) return null;
  if (trimmed === `Uploaded ${storedName}`) return title === storedName ? trimmed : null;
  return trimmed.replace(storedName, title);
}

function formatDate(value: string): string {
  return LIST_DATE_FORMATTER.format(new Date(value));
}

function formatBytes(bytes: number | null): string | null {
  if (bytes === null) return null;
  if (bytes < 1024) return `${String(bytes)} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = units[0] ?? 'KB';
  for (let i = 0; i < units.length; i++) {
    unit = units[i] ?? unit;
    if (value < 1024 || i === units.length - 1) break;
    value /= 1024;
  }
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${unit}`;
}
