'use client';

import { FileText, Image as ImageIcon, Link2, Upload } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';
import { toast } from 'sonner';

import type { ReactNode } from 'react';

import { promoteCapturedFileAction } from '@/app/actions/documents';
import { DocumentPreview } from '@/components/documents/document-preview';
import { EvidenceLink } from '@/components/evidence-link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

interface CapturedFileItem {
  id: string;
  name: string;
  metadata: Record<string, unknown>;
  visibility: 'team' | 'private' | 'specific_users';
  updatedAt: string;
  sourceRawEventId: string | null;
  currentVersion: {
    id: string;
    version: number;
    contentType: string | null;
    byteSize: number | null;
    processingStatus: string;
    createdAt: string;
  } | null;
  provenance: {
    source: string;
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
}

interface FolderOption {
  id: string;
  name: string;
}

interface Props {
  files: CapturedFileItem[];
  folders: FolderOption[];
  members: { id: string; label: string }[];
}

type Visibility = 'team' | 'private' | 'specific_users';

const ALL = 'all';

export function CapturedFilesList({ files, folders, members }: Props) {
  const [sourceFilter, setSourceFilter] = useState(ALL);
  const [typeFilter, setTypeFilter] = useState(ALL);
  const [statusFilter, setStatusFilter] = useState(ALL);
  const [dateFilter, setDateFilter] = useState(ALL);
  const [promoting, setPromoting] = useState<CapturedFileItem | null>(null);
  const sources = useMemo(
    () => [...new Set(files.map((file) => file.provenance.source))].sort(),
    [files],
  );
  const statuses = useMemo(
    () =>
      [
        ...new Set(
          files.map((file) => file.currentVersion?.processingStatus ?? 'pending').filter(Boolean),
        ),
      ].sort(),
    [files],
  );
  const visibleFiles = files.filter((file) => {
    const kind = fileKind(file.currentVersion?.contentType ?? null);
    const status = file.currentVersion?.processingStatus ?? 'pending';
    if (sourceFilter !== ALL && file.provenance.source !== sourceFilter) return false;
    if (typeFilter !== ALL && kind !== typeFilter) return false;
    if (statusFilter !== ALL && status !== statusFilter) return false;
    if (dateFilter !== ALL && !matchesDateFilter(file.updatedAt, dateFilter)) return false;
    return true;
  });

  if (files.length === 0) {
    return (
      <div className="rounded-sm border border-dashed border-border bg-card/30 p-8 text-center">
        <p className="font-mono text-xs uppercase tracking-[0.12em] text-fg-dim">
          No captured files
        </p>
        <p className="mx-auto mt-2 max-w-md text-sm text-fg-muted">
          Telegram and Slack attachments will appear here before they are promoted to documents.
        </p>
      </div>
    );
  }

  return (
    <section className="space-y-3">
      <div className="grid gap-2 rounded-sm border border-border bg-card p-3 md:grid-cols-4">
        <FilterSelect label="Source" value={sourceFilter} onChange={setSourceFilter}>
          <option value={ALL}>All sources</option>
          {sources.map((source) => (
            <option key={source} value={source}>
              {source}
            </option>
          ))}
        </FilterSelect>
        <FilterSelect label="Type" value={typeFilter} onChange={setTypeFilter}>
          <option value={ALL}>All types</option>
          <option value="image">Images</option>
          <option value="pdf">PDFs</option>
          <option value="audio">Audio</option>
          <option value="file">Other files</option>
        </FilterSelect>
        <FilterSelect label="Status" value={statusFilter} onChange={setStatusFilter}>
          <option value={ALL}>All statuses</option>
          {statuses.map((status) => (
            <option key={status} value={status}>
              {status}
            </option>
          ))}
        </FilterSelect>
        <FilterSelect label="Date" value={dateFilter} onChange={setDateFilter}>
          <option value={ALL}>Any time</option>
          <option value="7d">Last 7 days</option>
          <option value="30d">Last 30 days</option>
        </FilterSelect>
      </div>

      <ul className="space-y-2">
        {visibleFiles.map((file) => (
          <CapturedFileRow
            key={file.id}
            file={file}
            onPromote={() => {
              setPromoting(file);
            }}
          />
        ))}
      </ul>
      {visibleFiles.length === 0 ? (
        <div className="rounded-sm border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          No captured files match these filters.
        </div>
      ) : null}
      {promoting ? (
        <PromoteDialog
          file={promoting}
          folders={folders}
          members={members}
          onClose={() => {
            setPromoting(null);
          }}
        />
      ) : null}
    </section>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
}) {
  return (
    <label className="space-y-1">
      <span className="block font-mono text-[10px] uppercase tracking-[0.12em] text-fg-dim">
        {label}
      </span>
      <select
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        className="h-9 w-full rounded-sm border border-border bg-bg px-2 text-sm text-foreground"
      >
        {children}
      </select>
    </label>
  );
}

function CapturedFileRow({ file, onPromote }: { file: CapturedFileItem; onPromote: () => void }) {
  const contentType = file.currentVersion?.contentType ?? '';
  const Icon = contentType.startsWith('image/') ? ImageIcon : FileText;
  const eventId = file.provenance.parentEventId ?? file.sourceRawEventId;
  const presentation = file.presentation;
  const storedName = presentation.isGeneratedName ? presentation.storedName : null;

  return (
    <li className="grid gap-3 rounded-sm border border-border bg-card p-3 md:grid-cols-[minmax(0,1fr)_auto]">
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-sm border border-border bg-surface-2 text-muted-foreground">
            <Icon className="size-4" />
          </span>
          <span className="min-w-0">
            <span
              className="block truncate text-sm font-semibold text-foreground"
              title={presentation.displayTitle}
            >
              {presentation.displayTitle}
            </span>
            <span className="mt-0.5 block truncate font-mono text-[11px] uppercase tracking-[0.12em] text-fg-dim">
              {contentType || 'captured file'}
              {storedName ? (
                <span className="normal-case tracking-normal text-muted-foreground">
                  {' '}
                  · stored as {storedName}
                </span>
              ) : null}
            </span>
          </span>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Badge variant="secondary" className="rounded-sm font-mono text-[10px] uppercase">
            {file.provenance.source}
          </Badge>
          <Badge variant="outline" className="rounded-sm font-mono text-[10px] uppercase">
            {file.currentVersion?.processingStatus ?? 'pending'}
          </Badge>
          <Badge variant="outline" className="rounded-sm font-mono text-[10px] uppercase">
            {file.visibility}
          </Badge>
          <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-dim">
            {formatDate(file.updatedAt)}
          </span>
        </div>
        {file.description ? (
          <p className="mt-2 line-clamp-1 text-xs text-muted-foreground">{file.description}</p>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2">
        {file.currentVersion?.id && ['image', 'pdf', 'audio'].includes(fileKind(contentType)) ? (
          <DocumentPreview
            target={{ versionId: file.currentVersion.id }}
            compact
            label="Preview"
            className="w-full md:w-auto"
          />
        ) : null}
        {eventId ? (
          <EvidenceLink
            eventId={eventId}
            previewText={file.provenance.summary}
            source={file.provenance.source}
            occurredAt={file.provenance.occurredAt}
            className="inline-flex h-8 items-center gap-1 rounded-sm border border-border px-2 font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground"
          >
            <Link2 className="size-3.5" />
            Event
          </EvidenceLink>
        ) : null}
        <Button type="button" size="sm" onClick={onPromote}>
          <Upload className="mr-2 size-4" />
          Promote
        </Button>
      </div>
    </li>
  );
}

function PromoteDialog({
  file,
  folders,
  members,
  onClose,
}: {
  file: CapturedFileItem;
  folders: FolderOption[];
  members: { id: string; label: string }[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState(file.presentation.displayTitle);
  const [folderId, setFolderId] = useState('');
  const [visibility, setVisibility] = useState<Visibility>(file.visibility);
  const [visibilityUserIds, setVisibilityUserIds] = useState<string[]>([]);

  function submit(): void {
    startTransition(async () => {
      const result = await promoteCapturedFileAction({
        id: file.id,
        name,
        folderId: folderId || null,
        visibility,
        visibilityUserIds: visibility === 'specific_users' ? visibilityUserIds : [],
      });
      if (!result.ok || !result.documentId) {
        toast.error(result.error ?? 'Promotion failed');
        return;
      }
      toast.success('Promoted to documents');
      router.push(`/app/documents/${result.documentId}`);
    });
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4">
      <div className="w-full max-w-lg rounded-sm border border-border bg-card p-4 shadow-xl">
        <div className="mb-4">
          <h2 className="text-base font-semibold text-foreground">Promote captured file</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Turn this evidence attachment into curated team knowledge.
          </p>
        </div>
        <div className="space-y-3">
          <label className="block space-y-1">
            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-fg-dim">
              Title
            </span>
            <input
              value={name}
              onChange={(event) => {
                setName(event.target.value);
              }}
              className="h-9 w-full rounded-sm border border-border bg-bg px-2 text-sm"
            />
          </label>
          <label className="block space-y-1">
            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-fg-dim">
              Folder
            </span>
            <select
              value={folderId}
              onChange={(event) => {
                setFolderId(event.target.value);
              }}
              className="h-9 w-full rounded-sm border border-border bg-bg px-2 text-sm"
            >
              <option value="">Documents root</option>
              {folders.map((folder) => (
                <option key={folder.id} value={folder.id}>
                  {folder.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block space-y-1">
            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-fg-dim">
              Visibility
            </span>
            <select
              value={visibility}
              onChange={(event) => {
                setVisibility(event.target.value as Visibility);
              }}
              className="h-9 w-full rounded-sm border border-border bg-bg px-2 text-sm"
            >
              <option value="team">Team</option>
              <option value="private">Private</option>
              <option value="specific_users">Specific users</option>
            </select>
          </label>
          {visibility === 'specific_users' ? (
            <div className="max-h-36 space-y-1 overflow-auto rounded-sm border border-border p-2">
              {members.map((member) => (
                <label key={member.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={visibilityUserIds.includes(member.id)}
                    onChange={(event) => {
                      setVisibilityUserIds((current) =>
                        event.target.checked
                          ? [...current, member.id]
                          : current.filter((id) => id !== member.id),
                      );
                    }}
                  />
                  {member.label}
                </label>
              ))}
            </div>
          ) : null}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="button" onClick={submit} disabled={pending || !name.trim()}>
            {pending ? 'Promoting...' : 'Promote'}
          </Button>
        </div>
      </div>
    </div>
  );
}

function fileKind(contentType: string | null): 'image' | 'pdf' | 'audio' | 'file' {
  const base = contentType?.toLowerCase().split(';')[0]?.trim() ?? '';
  if (base.startsWith('image/')) return 'image';
  if (base === 'application/pdf') return 'pdf';
  if (base.startsWith('audio/')) return 'audio';
  return 'file';
}

function matchesDateFilter(value: string, filter: string): boolean {
  if (filter === ALL) return true;
  const days = filter === '7d' ? 7 : 30;
  return Date.now() - new Date(value).getTime() <= days * 24 * 60 * 60 * 1000;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(
    new Date(value),
  );
}
