'use client';

import { documentPresentation } from '@timeline/shared/documents/presentation';
import { Download, EyeOff, FileText, Link2, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import type { ReactNode } from 'react';

import {
  deleteDocumentAction,
  getDocumentDownloadUrlAction,
  renameDocumentAction,
} from '@/app/actions/documents';
import { DocumentPreview } from '@/components/documents/document-preview';
import { EvidenceLink } from '@/components/evidence-link';
import { HistoryBackLink } from '@/components/history-back-link';
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
  fileKind: 'captured' | 'document';
  name: string;
  metadata: Record<string, unknown>;
  folderId: string | null;
  folderPath: string;
  visibility: string;
  ownerUserId: string | null;
  currentVersionId: string | null;
  sourceRawEventId: string | null;
  createdAt: string;
  updatedAt: string;
  provenance: {
    source: string;
    sourceEventId: string | null;
    parentEventId: string | null;
    occurredAt: string | null;
    summary: string | null;
  };
}

interface Props {
  document: DocumentSummary;
  versions: VersionItem[];
  requestedVersion: number | null;
  currentVersionChunks: {
    id: string;
    representationKind: string;
    text: string;
    summary: string | null;
    pageNumber: number | null;
  }[];
}

function formatBytes(n: number | null): string {
  if (n === null) return '—';
  if (n < 1024) return `${String(n)} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

const STATUS_BADGE: Record<string, string> = {
  pending: 'border border-border bg-surface-2 text-muted-foreground',
  extracting: 'border border-border bg-surface-2 text-muted-foreground',
  chunked: 'border border-border bg-surface-2 text-muted-foreground',
  embedded: 'border border-border bg-surface-2 text-muted-foreground',
  deferred: 'border border-border bg-surface-2 text-muted-foreground',
  failed: 'border border-danger/40 bg-danger/10 text-danger',
};

function mediaKind(contentType: string | null): 'image' | 'audio' | 'pdf' | null {
  const base = contentType?.toLowerCase().split(';')[0]?.trim() ?? '';
  if (base.startsWith('image/')) return 'image';
  if (base.startsWith('audio/')) return 'audio';
  if (base === 'application/pdf') return 'pdf';
  return null;
}

export function DocumentDetail({
  document,
  versions,
  requestedVersion,
  currentVersionChunks,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [optimisticRename, setOptimisticRename] = useState<{
    id: string;
    name: string;
    updatedAt: string;
  } | null>(null);
  const [downloading, setDownloading] = useState<readonly string[]>([]);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState(document.name);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const currentDocument =
    optimisticRename?.id === document.id ? { ...document, ...optimisticRename } : document;
  const currentVersion =
    versions.find((version) => version.id === currentDocument.currentVersionId) ?? versions[0];
  const presentation = documentPresentation({
    name: currentDocument.name,
    contentType: currentVersion?.contentType ?? null,
    metadata: currentDocument.metadata,
    fileKind: currentDocument.fileKind,
  });
  const visibleDocumentName = presentation.displayTitle;
  const usingFriendlyName =
    presentation.isGeneratedName && visibleDocumentName !== currentDocument.name;

  function openRename(): void {
    setRenameValue(currentDocument.name);
    setRenameOpen(true);
  }

  function submitRename(): void {
    const name = renameValue.trim();
    if (!name || name === currentDocument.name) {
      setRenameOpen(false);
      return;
    }
    const previousRename = optimisticRename;
    setOptimisticRename({
      id: currentDocument.id,
      name,
      updatedAt: new Date().toISOString(),
    });
    setRenameOpen(false);
    startTransition(async () => {
      const res = await renameDocumentAction({ id: currentDocument.id, name });
      if (!res.ok) {
        setOptimisticRename(previousRename);
        toast.error(res.error ?? 'Rename failed');
      } else {
        router.refresh();
      }
    });
  }

  function confirmDelete(): void {
    setDeleteOpen(false);
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
    <div className="space-y-5">
      <HistoryBackLink
        fallbackHref={
          currentDocument.folderId
            ? `/app/documents?folder=${currentDocument.folderId}`
            : '/app/documents'
        }
        label="Back"
      />

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4 max-sm:flex-col">
          <div className="min-w-0 space-y-1">
            <CardTitle
              className="max-w-full break-all text-2xl leading-tight"
              title={currentDocument.name}
            >
              {visibleDocumentName}
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              {currentDocument.folderPath} · Updated{' '}
              {new Date(currentDocument.updatedAt).toLocaleString()}
            </p>
            {usingFriendlyName ? (
              <p className="max-w-full truncate text-xs text-muted-foreground">
                Stored as <span title={currentDocument.name}>{currentDocument.name}</span>
              </p>
            ) : null}
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {currentDocument.visibility !== 'team' && (
              <Badge variant="outline">{currentDocument.visibility}</Badge>
            )}
            <Button size="sm" variant="outline" onClick={openRename} disabled={pending}>
              Rename
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={() => {
                setDeleteOpen(true);
              }}
              disabled={pending}
            >
              <Trash2 className="mr-1 size-3.5" />
              Delete
            </Button>
          </div>
        </CardHeader>
      </Card>

      {currentVersion ? (
        <CurrentVersionPanel
          document={currentDocument}
          version={currentVersion}
          chunks={currentVersionChunks}
          onDownload={onDownload}
          downloading={downloading.includes(currentVersion.id)}
        />
      ) : null}

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
                    'flex items-center justify-between gap-3 py-3 max-sm:flex-col max-sm:items-stretch ' +
                    (highlight ? 'rounded bg-surface-2 px-2 -mx-2' : '')
                  }
                >
                  <div className="min-w-0 flex flex-col gap-1">
                    <div className="flex flex-wrap items-center gap-2">
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
                      <p className="text-xs text-danger">{v.processingError}</p>
                    )}
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        void onDownload(v.id);
                      }}
                      disabled={downloading.includes(v.id)}
                    >
                      <Download className="mr-1 size-3.5" />
                      {downloading.includes(v.id) ? 'Opening...' : 'Download'}
                    </Button>
                  </div>
                </li>
              );
            })}
            {versions.length === 0 && (
              <li className="py-6 text-center text-sm text-muted-foreground">No versions yet</li>
            )}
          </ul>
        </CardContent>
      </Card>
      {renameOpen ? (
        <ModalFrame
          title="Rename document"
          onClose={() => {
            setRenameOpen(false);
          }}
        >
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              submitRename();
            }}
          >
            <label className="block space-y-1">
              <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-fg-dim">
                Name
              </span>
              <input
                value={renameValue}
                onChange={(event) => {
                  setRenameValue(event.target.value);
                }}
                autoFocus
                className="h-9 w-full rounded-sm border border-border bg-bg px-2 text-sm text-foreground"
              />
            </label>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setRenameOpen(false);
                }}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={!renameValue.trim() || pending}>
                Save
              </Button>
            </div>
          </form>
        </ModalFrame>
      ) : null}
      {deleteOpen ? (
        <ModalFrame
          title="Delete document"
          onClose={() => {
            setDeleteOpen(false);
          }}
        >
          <div className="space-y-4">
            <p className="text-sm leading-6 text-muted-foreground">
              Versions stay in storage, but this drive entry will be hidden.
            </p>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setDeleteOpen(false);
                }}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={confirmDelete}
                disabled={pending}
              >
                Delete
              </Button>
            </div>
          </div>
        </ModalFrame>
      ) : null}
    </div>
  );
}

function ModalFrame({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4">
      <div className="w-full max-w-md rounded-sm border border-border bg-card p-4">
        <div className="mb-4 flex items-start justify-between gap-4">
          <h2 className="text-base font-semibold text-foreground">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground hover:text-foreground"
          >
            Close
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function CurrentVersionPanel({
  document,
  version,
  chunks,
  onDownload,
  downloading,
}: {
  document: DocumentSummary;
  version: VersionItem;
  chunks: Props['currentVersionChunks'];
  onDownload: (versionId: string) => Promise<void>;
  downloading: boolean;
}) {
  const kind = mediaKind(version.contentType);
  const description = bestChunkDescription(chunks);
  const eventId = document.provenance.parentEventId ?? document.provenance.sourceEventId;
  const sourceLabel =
    document.provenance.source === 'manual'
      ? 'Manual upload'
      : `${document.provenance.source.replace(/_/g, ' ')} capture`;
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4 max-sm:flex-col">
        <div>
          <CardTitle className="text-base">Current version</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            v{String(version.version)} · {formatBytes(version.byteSize)} ·{' '}
            {version.contentType ?? 'unknown'} · {new Date(version.createdAt).toLocaleString()}
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            void onDownload(version.id);
          }}
          disabled={downloading}
        >
          <Download className="mr-1 size-3.5" />
          {downloading ? 'Opening...' : 'Download'}
        </Button>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_18rem]">
          <div className="min-w-0">
            {kind ? (
              <DocumentPreview
                target={{ versionId: version.id }}
                autoLoad
                showButton={false}
                className="w-full"
              />
            ) : (
              <UnsupportedPreview chunks={chunks} />
            )}
          </div>
          <aside className="space-y-3">
            <InfoBlock title="Model understanding">
              {description ? (
                <p className="text-sm leading-6 text-fg-muted">{description}</p>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No extracted description is available yet.
                </p>
              )}
            </InfoBlock>
            <InfoBlock title="Provenance">
              <div className="space-y-2 text-sm text-fg-muted">
                <p>{sourceLabel}</p>
                {eventId ? (
                  <EvidenceLink
                    eventId={eventId}
                    previewText={document.provenance.summary}
                    source={document.provenance.source}
                    occurredAt={document.provenance.occurredAt}
                    className="inline-flex h-8 items-center gap-1 rounded-sm border border-border px-2 font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground"
                  >
                    <Link2 className="size-3.5" />
                    Event
                  </EvidenceLink>
                ) : null}
              </div>
            </InfoBlock>
            <InfoBlock title="Agent status">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={
                    'rounded px-1.5 py-0.5 text-[10px] font-medium ' +
                    (STATUS_BADGE[version.processingStatus] ?? STATUS_BADGE.pending ?? '')
                  }
                >
                  {version.processingStatus}
                </span>
                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                  <FileText className="size-3.5" />
                  {chunks.length === 1 ? '1 chunk' : `${String(chunks.length)} chunks`}
                </span>
              </div>
              {version.processingError ? (
                <p className="mt-2 text-xs text-danger">{version.processingError}</p>
              ) : null}
            </InfoBlock>
          </aside>
        </div>
      </CardContent>
    </Card>
  );
}

function InfoBlock({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-sm border border-border bg-bg px-3 py-2">
      <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-fg-dim">{title}</p>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function UnsupportedPreview({ chunks }: { chunks: Props['currentVersionChunks'] }) {
  const text = bestChunkText(chunks);
  return (
    <div className="min-h-72 rounded-sm border border-border bg-bg p-4">
      {text ? (
        <div>
          <p className="mb-3 font-mono text-[10px] uppercase tracking-[0.12em] text-fg-dim">
            Extracted text
          </p>
          <pre className="max-h-[58vh] whitespace-pre-wrap break-words text-sm leading-6 text-fg-muted">
            {text}
          </pre>
        </div>
      ) : (
        <div className="flex min-h-64 items-center gap-3 text-sm text-muted-foreground">
          <EyeOff className="size-4 shrink-0" />
          Preview is not available for this file type.
        </div>
      )}
    </div>
  );
}

function bestChunkDescription(chunks: Props['currentVersionChunks']): string | null {
  const visual = chunks.find((chunk) => chunk.representationKind === 'visual_description');
  const firstSummary = visual?.summary ?? chunks.find((chunk) => chunk.summary)?.summary;
  if (firstSummary?.trim()) return firstSummary.trim();
  const firstText = visual?.text ?? chunks[0]?.text;
  if (!firstText?.trim()) return null;
  return firstText.trim().replace(/\s+/g, ' ').slice(0, 420);
}

function bestChunkText(chunks: Props['currentVersionChunks']): string | null {
  const sourceText = chunks.find((chunk) => chunk.representationKind === 'source_text');
  const firstText = sourceText?.text ?? chunks[0]?.text;
  if (!firstText?.trim()) return null;
  return firstText.trim().slice(0, 6000);
}
