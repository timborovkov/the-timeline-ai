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
}

export function DocumentDrive({ currentFolderId, breadcrumbs, folders, documents }: Props) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  const [uploading, setUploading] = useState<string | null>(null);

  async function handleUploadFile(file: File): Promise<void> {
    setUploading(file.name);
    try {
      const req = await requestDocumentUploadAction({
        folderId: currentFolderId,
        name: file.name,
        filename: file.name,
        contentType: file.type || 'application/octet-stream',
        visibility: 'team',
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
      setUploading(null);
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
        visibility: 'team',
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
          <Button size="sm" onClick={() => fileInputRef.current?.click()} disabled={!!uploading}>
            <Upload className="mr-2 h-4 w-4" />
            {uploading ? `Uploading ${uploading}…` : 'Upload'}
          </Button>
          <input ref={fileInputRef} type="file" className="hidden" onChange={onFileChange} />
        </div>
      </header>

      <div
        onDragOver={(e) => {
          e.preventDefault();
        }}
        onDrop={onDrop}
        className="rounded-sm border border-dashed border-border bg-card/30 p-6"
      >
        {folders.length === 0 && documents.length === 0 ? (
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
            {documents.length > 0 && (
              <section>
                <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Documents
                </h2>
                <ul className="space-y-2">
                  {documents.map((d) => (
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
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
