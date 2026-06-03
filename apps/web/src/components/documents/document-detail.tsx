'use client';

import { ArrowLeft, Download, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import {
  deleteDocumentAction,
  getDocumentDownloadUrlAction,
  renameDocumentAction,
} from '@/app/actions/documents';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface VersionItem {
  id: string;
  version: number;
  byteSize: number | null;
  contentType: string | null;
  processingStatus: string;
  processingError: string | null;
  createdAt: string;
  uploadedByUserId: string | null;
}

interface DocumentSummary {
  id: string;
  name: string;
  folderId: string | null;
  folderPath: string;
  visibility: string;
  ownerUserId: string | null;
  currentVersionId: string | null;
  createdAt: string;
  updatedAt: string;
}

interface Props {
  document: DocumentSummary;
  versions: VersionItem[];
  requestedVersion: number | null;
}

function formatBytes(n: number | null): string {
  if (n === null) return '—';
  if (n < 1024) return `${String(n)} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

const STATUS_BADGE: Record<string, string> = {
  pending: 'bg-muted text-muted-foreground',
  extracting: 'bg-amber-100 text-amber-900',
  chunked: 'bg-blue-100 text-blue-900',
  embedded: 'bg-emerald-100 text-emerald-900',
  failed: 'bg-rose-100 text-rose-900',
};

export function DocumentDetail({ document, versions, requestedVersion }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [optimisticRename, setOptimisticRename] = useState<{
    id: string;
    name: string;
    updatedAt: string;
  } | null>(null);
  const [downloading, setDownloading] = useState<readonly string[]>([]);
  const currentDocument =
    optimisticRename?.id === document.id ? { ...document, ...optimisticRename } : document;

  function onRename(): void {
    const name = window.prompt('New name', currentDocument.name);
    if (!name?.trim() || name === currentDocument.name) return;
    startTransition(async () => {
      const trimmedName = name.trim();
      const res = await renameDocumentAction({ id: currentDocument.id, name: trimmedName });
      if (!res.ok) toast.error(res.error ?? 'Rename failed');
      else {
        setOptimisticRename({
          id: currentDocument.id,
          name: trimmedName,
          updatedAt: new Date().toISOString(),
        });
        router.refresh();
      }
    });
  }

  function onDelete(): void {
    if (
      !window.confirm('Delete this document? Versions stay in storage; the drive entry is hidden.')
    )
      return;
    startTransition(async () => {
      const res = await deleteDocumentAction(currentDocument.id);
      if (!res.ok) toast.error(res.error ?? 'Delete failed');
      else {
        toast.success('Document deleted');
        router.push(
          currentDocument.folderId
            ? `/app/documents?folder=${currentDocument.folderId}`
            : '/app/documents',
        );
      }
    });
  }

  async function onDownload(versionId: string): Promise<void> {
    setDownloading((prev) => (prev.includes(versionId) ? prev : [...prev, versionId]));
    try {
      const res = await getDocumentDownloadUrlAction({ versionId });
      if (!res.ok || !res.url) {
        toast.error(res.error ?? 'Failed to fetch download URL');
        return;
      }
      window.open(res.url, '_blank', 'noopener,noreferrer');
    } finally {
      setDownloading((prev) => prev.filter((id) => id !== versionId));
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={
            currentDocument.folderId
              ? `/app/documents?folder=${currentDocument.folderId}`
              : '/app/documents'
          }
          className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="mr-1 size-3.5" />
          Back to {currentDocument.folderPath}
        </Link>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div className="space-y-1">
            <CardTitle className="text-2xl">{currentDocument.name}</CardTitle>
            <p className="text-sm text-muted-foreground">
              {currentDocument.folderPath} · Updated{' '}
              {new Date(currentDocument.updatedAt).toLocaleString()}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {currentDocument.visibility !== 'team' && (
              <Badge variant="outline">{currentDocument.visibility}</Badge>
            )}
            <Button size="sm" variant="outline" onClick={onRename} disabled={pending}>
              Rename
            </Button>
            <Button size="sm" variant="destructive" onClick={onDelete} disabled={pending}>
              <Trash2 className="mr-1 size-3.5" />
              Delete
            </Button>
          </div>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Version history</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="divide-y divide-border">
            {versions.map((v) => {
              const highlight = requestedVersion === v.version;
              const isCurrent = v.id === currentDocument.currentVersionId;
              return (
                <li
                  key={v.id}
                  className={
                    'flex items-center justify-between py-3 ' +
                    (highlight ? 'bg-amber-50/30 rounded px-2 -mx-2' : '')
                  }
                >
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm font-semibold">v{String(v.version)}</span>
                      {isCurrent && (
                        <Badge variant="outline" className="text-[10px]">
                          current
                        </Badge>
                      )}
                      <span
                        className={
                          'rounded px-1.5 py-0.5 text-[10px] font-medium ' +
                          (STATUS_BADGE[v.processingStatus] ?? STATUS_BADGE.pending ?? '')
                        }
                      >
                        {v.processingStatus}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {formatBytes(v.byteSize)} · {v.contentType ?? 'unknown'} ·{' '}
                      {new Date(v.createdAt).toLocaleString()}
                    </p>
                    {v.processingError && (
                      <p className="text-xs text-rose-600">{v.processingError}</p>
                    )}
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      void onDownload(v.id);
                    }}
                    disabled={downloading.includes(v.id)}
                  >
                    <Download className="mr-1 size-3.5" />
                    {downloading.includes(v.id) ? 'Opening…' : 'Download'}
                  </Button>
                </li>
              );
            })}
            {versions.length === 0 && (
              <li className="py-6 text-center text-sm text-muted-foreground">No versions yet</li>
            )}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
