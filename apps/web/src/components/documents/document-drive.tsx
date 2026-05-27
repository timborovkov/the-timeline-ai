'use client';

import { Folder as FolderIcon, FolderPlus, Upload } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState, useTransition } from 'react';
import { toast } from 'sonner';

import {
  createFolderAction,
  deleteFolderAction,
  finalizeDocumentVersionAction,
  requestDocumentUploadAction,
} from '@/app/actions/documents';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useDocumentListQuery } from '@/lib/use-paginated-queries';

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
  defaultVisibility: 'team' | 'private' | 'specific_users';
  defaultVisibilityUserIds: string[] | null;
  members: { id: string; label: string }[];
}

export function DocumentDrive({
  currentFolderId,
  breadcrumbs,
  folders,
  documents,
  defaultVisibility,
  defaultVisibilityUserIds,
  members,
}: Props) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  // Set of in-flight upload filenames. Multi-file drop fires
  // handleUploadFile concurrently for each file; a single `string |
  // null` state would let the first finisher clobber the "Uploading…"
  // indicator while siblings are still running. The Set lets all
  // active uploads count toward "busy" and surface the most recent
  // filename in the button label.
  const [uploading, setUploading] = useState<readonly string[]>([]);
  const [visibility, setVisibility] = useState<'team' | 'private' | 'specific_users'>(
    defaultVisibility,
  );
  const [visibilityUserIds, setVisibilityUserIds] = useState<string[]>(
    defaultVisibilityUserIds ?? [],
  );

  async function handleUploadFile(file: File): Promise<void> {
    setUploading((prev) => [...prev, file.name]);
    try {
      const req = await requestDocumentUploadAction({
        folderId: currentFolderId,
        name: file.name,
        filename: file.name,
        contentType: file.type || 'application/octet-stream',
        visibility,
        visibilityUserIds,
      });
      if (!req.ok || !req.url || !req.versionId) {
        toast.error(req.error ?? 'Upload failed');
        return;
      }
      if (req.maxBytes && file.size > req.maxBytes) {
        toast.error(`File exceeds ${String(Math.round(req.maxBytes / 1024 / 1024))} MiB limit`);
        return;
      }
      const put = await fetch(req.url, {
        method: 'PUT',
        body: file,
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
      });
      if (!put.ok) {
        toast.error(`Upload failed (${String(put.status)})`);
        return;
      }
      const fin = await finalizeDocumentVersionAction({ versionId: req.versionId });
      if (!fin.ok) {
        toast.error(fin.error ?? 'Finalize failed');
        return;
      }
      toast.success(`Uploaded ${file.name}`);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Upload error');
    } finally {
      // Remove ONLY this file's entry — leave any sibling uploads
      // still in-flight in the busy set. Splice-by-first-index handles
      // the rare case of dropping the same filename twice in one batch.
      setUploading((prev) => {
        const i = prev.indexOf(file.name);
        if (i < 0) return prev;
        return [...prev.slice(0, i), ...prev.slice(i + 1)];
      });
    }
  }

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>): void {
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
        visibilityUserIds,
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

  function onDrop(e: React.DragEvent<HTMLDivElement>): void {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files);
    for (const file of files) void handleUploadFile(file);
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
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
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={onNewFolder} disabled={pending}>
            <FolderPlus className="mr-2 h-4 w-4" />
            New folder
          </Button>
          <Button
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading.length > 0}
          >
            <Upload className="mr-2 h-4 w-4" />
            {uploading.length === 0
              ? 'Upload'
              : uploading.length === 1
                ? `Uploading ${uploading[0]}…`
                : `Uploading ${String(uploading.length)} files…`}
          </Button>
          <input ref={fileInputRef} type="file" className="hidden" onChange={onFileChange} />
        </div>
      </header>
      <div className="flex flex-wrap items-center gap-3 rounded-sm border border-border p-3 text-sm">
        <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-dim">
          New item visibility
        </span>
        <select
          value={visibility}
          onChange={(e) => {
            setVisibility(e.target.value as 'team' | 'private' | 'specific_users');
          }}
          className="h-8 rounded-sm border border-border bg-bg px-2 text-sm"
        >
          <option value="team">Team</option>
          <option value="private">Private</option>
          <option value="specific_users">Specific users</option>
        </select>
        {members.map((m) => (
          <label key={m.id} className="flex items-center gap-1 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={visibilityUserIds.includes(m.id)}
              onChange={(e) => {
                setVisibilityUserIds((prev) =>
                  e.target.checked
                    ? [...new Set([...prev, m.id])]
                    : prev.filter((id) => id !== m.id),
                );
              }}
            />
            {m.label}
          </label>
        ))}
      </div>

      <div
        onDragOver={(e) => {
          e.preventDefault();
        }}
        onDrop={onDrop}
        className="rounded-sm border border-dashed border-border bg-card/30 p-6"
      >
        {folders.length === 0 && visibleDocuments.length === 0 ? (
          <p className="text-center text-sm text-muted-foreground">
            Drag a file here or click Upload to get started.
          </p>
        ) : (
          <div className="space-y-6">
            {folders.length > 0 && (
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
                        <FolderIcon className="h-4 w-4 text-muted-foreground" />
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
            )}
            {visibleDocuments.length > 0 && (
              <section>
                <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Documents
                </h2>
                <ul className="space-y-2">
                  {visibleDocuments.map((d) => (
                    <li
                      key={d.id}
                      className="flex items-center justify-between rounded-sm border border-border bg-card p-3 hover:border-fg/20"
                    >
                      <Link
                        href={`/app/documents/${d.id}`}
                        className="flex items-center gap-3 text-sm"
                      >
                        <span className="font-medium">{d.name}</span>
                        {d.visibility !== 'team' && (
                          <Badge variant="outline" className="text-[10px]">
                            {d.visibility}
                          </Badge>
                        )}
                      </Link>
                      <span className="text-xs text-muted-foreground">
                        {new Date(d.updatedAt).toLocaleDateString()}
                      </span>
                    </li>
                  ))}
                </ul>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-3"
                  disabled={!documentQuery.hasNextPage || documentQuery.isFetchingNextPage}
                  onClick={() => {
                    void documentQuery.fetchNextPage();
                  }}
                >
                  {documentQuery.isFetchingNextPage
                    ? 'Loading...'
                    : documentQuery.hasNextPage
                      ? 'Load more'
                      : 'End'}
                </Button>
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
