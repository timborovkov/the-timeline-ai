'use client';

import {
  documentPresentation,
  truncateFilenameMiddle,
} from '@timeline/shared/documents/presentation';
import { Download, EyeOff, FileText, History, Link2, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useId, useState, useTransition } from 'react';

import type { ReactNode } from 'react';

import {
  deleteDocumentAction,
  getDocumentDownloadUrlAction,
  renameDocumentAction,
} from '@/app/actions/documents';
import { Breadcrumb } from '@/components/breadcrumb';
import { ChatViewContextBinder } from '@/components/chat/chat-view-context';
import { DocumentPreview } from '@/components/documents/document-preview';
import { EmptyState } from '@/components/empty-state';
import { EvidenceLink } from '@/components/evidence-link';
import { PinButton } from '@/components/pins/pin-button';
import { RelativeTimestamp } from '@/components/relative-timestamp';
import { SectionHeading } from '@/components/section-heading';
import { StatusBadge } from '@/components/status-badge';
import { TechnicalDetails } from '@/components/technical-details';
import { useAppDialog } from '@/components/ui/app-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { notifyAction, notifyError } from '@/lib/notify';
import { statusLabel } from '@/lib/status-labels';

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
  activeVersionId: string | null;
  activeVersionChunks: {
    id: string;
    representationKind: string;
    text: string;
    summary: string | null;
    pageNumber: number | null;
  }[];
  initialPinned?: boolean;
}

function formatBytes(n: number | null): string {
  if (n === null) return '—';
  if (n < 1024) return `${String(n)} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

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
  activeVersionId,
  activeVersionChunks,
  initialPinned = false,
}: Props) {
  const router = useRouter();
  const dialog = useAppDialog();
  const [pending, startTransition] = useTransition();
  const [optimisticRename, setOptimisticRename] = useState<{
    id: string;
    name: string;
    updatedAt: string;
  } | null>(null);
  const [downloading, setDownloading] = useState<readonly string[]>([]);
  const currentDocument =
    optimisticRename?.id === document.id ? { ...document, ...optimisticRename } : document;
  const activeVersion =
    versions.find((version) => version.id === activeVersionId) ??
    versions.find((version) => version.id === currentDocument.currentVersionId) ??
    versions[0];
  const presentation = documentPresentation({
    name: currentDocument.name,
    contentType: activeVersion?.contentType ?? null,
    metadata: currentDocument.metadata,
    fileKind: currentDocument.fileKind,
  });
  const visibleDocumentName = presentation.displayTitle;
  const usingFriendlyName =
    presentation.isGeneratedName && visibleDocumentName !== currentDocument.name;

  async function onRename(): Promise<void> {
    const name = await dialog.input({
      title: 'Rename document',
      description: 'Choose a new display name for this document.',
      inputLabel: 'Name',
      defaultValue: currentDocument.name,
      confirmLabel: 'Rename',
    });
    const trimmedName = name?.trim();
    if (!trimmedName || trimmedName === currentDocument.name) return;
    const previousRename = optimisticRename;
    const previousName = currentDocument.name;
    setOptimisticRename({
      id: currentDocument.id,
      name: trimmedName,
      updatedAt: new Date().toISOString(),
    });
    startTransition(async () => {
      const result = await notifyAction({
        id: `document:${currentDocument.id}`,
        loading: 'Renaming document…',
        success: 'Document renamed',
        error: 'Couldn’t rename document',
        run: async () => {
          const res = await renameDocumentAction({ id: currentDocument.id, name: trimmedName });
          return res.ok ? {} : { error: res.error ?? 'Couldn’t rename document' };
        },
        undo: {
          run: async () => {
            setOptimisticRename({
              id: currentDocument.id,
              name: previousName,
              updatedAt: new Date().toISOString(),
            });
            const res = await renameDocumentAction({
              id: currentDocument.id,
              name: previousName,
            });
            if (res.ok) router.refresh();
            return res.ok ? {} : { error: res.error ?? 'Couldn’t undo' };
          },
          success: 'Document renamed',
        },
      });
      if (result.error) setOptimisticRename(previousRename);
      else router.refresh();
    });
  }

  async function onDelete(): Promise<void> {
    const confirmed = await dialog.confirm({
      title: 'Delete document?',
      description: 'Versions stay in storage; the drive entry is hidden.',
      confirmLabel: 'Delete document',
      destructive: true,
    });
    if (!confirmed) return;
    startTransition(async () => {
      const result = await notifyAction({
        id: `document:${currentDocument.id}:delete`,
        loading: 'Deleting document…',
        success: 'Document deleted',
        error: 'Couldn’t delete document',
        run: async () => {
          const res = await deleteDocumentAction(currentDocument.id);
          return res.ok ? {} : { error: res.error ?? 'Couldn’t delete document' };
        },
      });
      if (result.error) return;
      router.push(
        currentDocument.folderId
          ? `/app/documents?folder=${currentDocument.folderId}`
          : '/app/documents',
      );
    });
  }

  async function onDownload(versionId: string): Promise<void> {
    setDownloading((prev) => (prev.includes(versionId) ? prev : [...prev, versionId]));
    try {
      const res = await getDocumentDownloadUrlAction({ versionId });
      if (!res.ok || !res.url) {
        notifyError('document:download', 'Couldn’t download document');
        return;
      }
      window.open(res.url, '_blank', 'noopener,noreferrer');
    } finally {
      setDownloading((prev) => prev.filter((id) => id !== versionId));
    }
  }

  return (
    <div className="space-y-5">
      <Breadcrumb
        items={[
          {
            label: 'Documents',
            href: currentDocument.folderId
              ? `/app/documents?folder=${currentDocument.folderId}`
              : '/app/documents',
          },
          { label: 'Document' },
        ]}
      />

      <section className="flex flex-row items-start justify-between gap-4 border-y border-border py-4 max-sm:flex-col">
        <div className="min-w-0 space-y-1">
          <h1
            className="max-w-full break-all text-2xl font-semibold leading-tight tracking-tight"
            title={currentDocument.name}
          >
            {visibleDocumentName}
          </h1>
          <p className="text-sm text-muted-foreground">
            {currentDocument.folderPath} · Updated{' '}
            <RelativeTimestamp value={currentDocument.updatedAt} />
          </p>
          {usingFriendlyName ? (
            <p className="max-w-full truncate text-xs text-muted-foreground">
              Stored as{' '}
              <span title={currentDocument.name}>
                {truncateFilenameMiddle(currentDocument.name)}
              </span>
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {currentDocument.visibility !== 'team' && (
            <Badge variant="outline">{statusLabel(currentDocument.visibility)}</Badge>
          )}
          <ChatViewContextBinder
            viewKey={`document:${currentDocument.id}`}
            kind="document"
            href={`/app/documents/${currentDocument.id}`}
            label={currentDocument.name}
            documentId={currentDocument.id}
          />
          <PinButton
            target={{ kind: 'document', key: currentDocument.id }}
            initialPinned={initialPinned}
          />
          <Button size="sm" variant="outline" onClick={() => void onRename()} disabled={pending}>
            Rename
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="text-fg-dim hover:text-danger"
            onClick={() => void onDelete()}
            disabled={pending}
          >
            <Trash2 className="mr-1 size-3.5" />
            Delete
          </Button>
        </div>
      </section>

      {activeVersion ? (
        <CurrentVersionPanel
          document={currentDocument}
          version={activeVersion}
          chunks={activeVersionChunks}
          isCurrentVersion={activeVersion.id === currentDocument.currentVersionId}
          onDownload={onDownload}
          downloading={downloading.includes(activeVersion.id)}
        />
      ) : null}

      <section className="space-y-3 border-y border-border py-4">
        <SectionHeading>Version history</SectionHeading>
        {versions.length === 0 ? (
          <EmptyState
            icon={History}
            size="inset"
            title="No versions yet"
            body="New uploads of this document will appear here as version history."
          />
        ) : (
          <ul className="divide-y divide-border">
            {versions.map((v) => {
              const highlight = requestedVersion === v.version;
              const isCurrent = v.id === currentDocument.currentVersionId;
              return (
                <li
                  key={v.id}
                  className={
                    'flex items-center justify-between gap-3 py-3 max-sm:flex-col max-sm:items-stretch ' +
                    (highlight || activeVersion?.id === v.id
                      ? 'rounded bg-surface-2 px-2 -mx-2'
                      : '')
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
                      <StatusBadge status={v.processingStatus} />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {formatBytes(v.byteSize)} · {v.contentType ?? 'unknown'} ·{' '}
                      <RelativeTimestamp value={v.createdAt} />
                    </p>
                    {v.processingError ? (
                      <TechnicalDetails
                        items={[
                          {
                            label: 'Processing error',
                            value: v.processingError,
                            copyValue: v.processingError,
                          },
                        ]}
                      />
                    ) : null}
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    <Button
                      size="sm"
                      variant={activeVersion?.id === v.id ? 'default' : 'outline'}
                      asChild
                    >
                      <Link href={`/app/documents/${document.id}?version=${String(v.version)}`}>
                        Preview
                      </Link>
                    </Button>
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
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
      {dialog.node}
    </div>
  );
}

function CurrentVersionPanel({
  document,
  version,
  chunks,
  isCurrentVersion,
  onDownload,
  downloading,
}: {
  document: DocumentSummary;
  version: VersionItem;
  chunks: Props['activeVersionChunks'];
  isCurrentVersion: boolean;
  onDownload: (versionId: string) => Promise<void>;
  downloading: boolean;
}) {
  const modelUnderstandingId = useId();
  const contentExcerptsId = useId();
  const kind = mediaKind(version.contentType);
  const description = bestChunkDescription(chunks);
  const eventId = document.provenance.parentEventId ?? document.provenance.sourceEventId;
  const sourceLabel =
    document.provenance.source === 'manual'
      ? 'Manual upload'
      : `${document.provenance.source.replace(/_/g, ' ')} capture`;
  return (
    <section className="space-y-3 border-y border-border py-4">
      <div className="flex flex-row items-start justify-between gap-4 max-sm:flex-col">
        <div>
          <SectionHeading>
            {isCurrentVersion ? 'Current version' : 'Selected version'}
          </SectionHeading>
          <p className="mt-1 text-xs text-muted-foreground">
            v{String(version.version)} · {formatBytes(version.byteSize)} ·{' '}
            {version.contentType ?? 'unknown'} · <RelativeTimestamp value={version.createdAt} />
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
          {downloading ? 'Opening…' : 'Download'}
        </Button>
      </div>
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
        <aside aria-label="Document context" className="space-y-3">
          <InfoBlock
            title="Model understanding"
            headingId={modelUnderstandingId}
            contentClassName="max-h-72 overflow-y-auto pr-1"
            contentScrollable
          >
            {description ? (
              <p className="break-words text-sm leading-6 text-fg-muted">{description}</p>
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
                  className="inline-flex h-8 items-center gap-1 rounded-sm border border-border px-2 text-xs text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground"
                >
                  <Link2 className="size-3.5" />
                  Event
                </EvidenceLink>
              ) : null}
            </div>
          </InfoBlock>
          <InfoBlock title="Agent status">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={version.processingStatus} />
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <FileText className="size-3.5" />
                {chunks.length === 1 ? '1 chunk' : `${String(chunks.length)} chunks`}
              </span>
            </div>
            {version.processingError ? (
              <TechnicalDetails
                className="mt-2"
                items={[
                  {
                    label: 'Processing error',
                    value: version.processingError,
                    copyValue: version.processingError,
                  },
                ]}
              />
            ) : null}
          </InfoBlock>
          {chunks.length > 0 ? (
            <InfoBlock
              title="Content excerpts"
              headingId={contentExcerptsId}
              contentClassName="space-y-3"
            >
              <ChunkCitationList chunks={chunks} ariaLabelledBy={contentExcerptsId} />
              <TechnicalDetails
                summary="Indexing details"
                items={chunks.map((chunk, index) => ({
                  id: chunk.id,
                  label: `Excerpt ${String(index + 1)}`,
                  value: `${chunk.id} · ${chunk.representationKind}`,
                  copyValue: chunk.id,
                }))}
              />
            </InfoBlock>
          ) : null}
        </aside>
      </div>
    </section>
  );
}

function ChunkCitationList({
  chunks,
  ariaLabelledBy,
}: {
  chunks: Props['activeVersionChunks'];
  ariaLabelledBy: string;
}) {
  return (
    <ol
      aria-labelledby={ariaLabelledBy}
      className="max-h-72 space-y-2 overflow-y-auto rounded-sm pr-1"
    >
      {chunks.map((chunk) => (
        <li
          key={chunk.id}
          id={`chunk-${chunk.id}`}
          className="scroll-mt-24 rounded-sm border border-border bg-surface px-2.5 py-2 text-xs"
        >
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-fg-dim">
            {chunk.pageNumber !== null ? <span>Page {String(chunk.pageNumber)}</span> : null}
          </div>
          <p className="mt-1 line-clamp-3 break-words leading-5 text-fg-muted">
            {chunk.summary ?? chunk.text}
          </p>
        </li>
      ))}
    </ol>
  );
}

function InfoBlock({
  title,
  children,
  contentClassName = '',
  headingId,
  contentScrollable = false,
}: {
  title: string;
  children: ReactNode;
  contentClassName?: string;
  headingId?: string;
  contentScrollable?: boolean;
}) {
  const generatedHeadingId = useId();
  const resolvedHeadingId = headingId ?? generatedHeadingId;

  return (
    <div className="rounded-sm border border-border bg-bg px-3 py-2">
      <h3 id={resolvedHeadingId} className="text-sm font-semibold text-fg">
        {title}
      </h3>
      <div
        className={`mt-1 ${contentClassName}`}
        {...(contentScrollable
          ? {
              'aria-labelledby': resolvedHeadingId,
              role: 'region',
              tabIndex: 0,
            }
          : {})}
      >
        {children}
      </div>
    </div>
  );
}

function UnsupportedPreview({ chunks }: { chunks: Props['activeVersionChunks'] }) {
  const text = bestChunkText(chunks);
  return (
    <div className="min-h-72 rounded-sm border border-border bg-bg p-4">
      {text ? (
        <div>
          <p className="mb-3 text-[11px] text-fg-dim">Extracted text</p>
          <pre className="max-h-[58vh] overflow-y-auto whitespace-pre-wrap break-words pr-1 text-sm leading-6 text-fg-muted">
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

function bestChunkDescription(chunks: Props['activeVersionChunks']): string | null {
  const visual = chunks.find((chunk) => chunk.representationKind === 'visual_description');
  const firstSummary = visual?.summary ?? chunks.find((chunk) => chunk.summary)?.summary;
  if (firstSummary?.trim()) return firstSummary.trim();
  const firstText = visual?.text ?? chunks[0]?.text;
  if (!firstText?.trim()) return null;
  return firstText.trim().replace(/\s+/g, ' ').slice(0, 420);
}

function bestChunkText(chunks: Props['activeVersionChunks']): string | null {
  const sourceText = chunks.find((chunk) => chunk.representationKind === 'source_text');
  const firstText = sourceText?.text ?? chunks[0]?.text;
  if (!firstText?.trim()) return null;
  return firstText.trim().slice(0, 6000);
}
