'use client';

import { truncateFilenameMiddle } from '@timeline/shared/documents/presentation';
import { FileText, Image as ImageIcon, Link2, Upload } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useReducer, useTransition } from 'react';
import { toast } from 'sonner';

import type { ReactNode } from 'react';

import { promoteCapturedFileAction } from '@/app/actions/documents';
import { DocumentPreview } from '@/components/documents/document-preview';
import { EvidenceLink } from '@/components/evidence-link';
import { FilterMultiSelect } from '@/components/filter-multi-select';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { selectedValues } from '@/lib/filter-values';

interface CapturedFileItem {
  id: string;
  name: string;
  metadata: Record<string, unknown>;
  visibility: 'team' | 'private' | 'specific_users';
  visibilityUserIds: string[] | null;
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
  nextCursor?: string | null;
  folders: FolderOption[];
  members: { id: string; label: string }[];
}

type Visibility = 'team' | 'private' | 'specific_users';

const ALL = 'all';
const capturedFileDateFormatter = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
});

interface CapturedFilesPageResponse {
  items: CapturedFileItem[];
  nextCursor: string | null;
}

interface CapturedFilesUiState {
  sourceFilter: string;
  typeFilter: string;
  statusFilter: string;
  dateFilter: string;
  promoting: CapturedFileItem | null;
}

type CapturedFilesUiAction =
  | { type: 'source'; value: string }
  | { type: 'fileType'; value: string }
  | { type: 'status'; value: string }
  | { type: 'date'; value: string }
  | { type: 'clear_filters' }
  | { type: 'promote'; file: CapturedFileItem | null };

const capturedFilesUiInitialState: CapturedFilesUiState = {
  sourceFilter: '',
  typeFilter: '',
  statusFilter: '',
  dateFilter: ALL,
  promoting: null,
};

function capturedFilesUiReducer(
  state: CapturedFilesUiState,
  action: CapturedFilesUiAction,
): CapturedFilesUiState {
  switch (action.type) {
    case 'source':
      return { ...state, sourceFilter: action.value };
    case 'fileType':
      return { ...state, typeFilter: action.value };
    case 'status':
      return { ...state, statusFilter: action.value };
    case 'date':
      return { ...state, dateFilter: action.value };
    case 'clear_filters':
      return { ...state, sourceFilter: '', typeFilter: '', statusFilter: '', dateFilter: ALL };
    case 'promote':
      return { ...state, promoting: action.file };
  }
}

const FILE_TYPE_OPTIONS = [
  { value: 'image', label: 'Images' },
  { value: 'pdf', label: 'PDFs' },
  { value: 'audio', label: 'Audio' },
  { value: 'file', label: 'Other files' },
] as const;

interface PaginationState {
  inputFiles: CapturedFileItem[];
  inputCursor: string | null;
  loadedFiles: CapturedFileItem[];
  cursor: string | null;
}

type PaginationAction =
  | {
      type: 'reset';
      files: CapturedFileItem[];
      nextCursor: string | null;
    }
  | {
      type: 'append';
      files: CapturedFileItem[];
      nextCursor: string | null;
    };

function paginationStateForProps(
  files: CapturedFileItem[],
  nextCursor: string | null,
  current?: PaginationState,
): PaginationState {
  if (current?.inputFiles === files && current.inputCursor === nextCursor) return current;
  return {
    inputFiles: files,
    inputCursor: nextCursor,
    loadedFiles: files,
    cursor: nextCursor,
  };
}

function paginationReducer(state: PaginationState, action: PaginationAction): PaginationState {
  if (action.type === 'reset') {
    if (state.inputFiles === action.files && state.inputCursor === action.nextCursor) {
      return state;
    }
    return {
      inputFiles: action.files,
      inputCursor: action.nextCursor,
      loadedFiles: action.files,
      cursor: action.nextCursor,
    };
  }
  const seen = new Set(state.loadedFiles.map((file) => file.id));
  return {
    ...state,
    loadedFiles: [...state.loadedFiles, ...action.files.filter((file) => !seen.has(file.id))],
    cursor: action.nextCursor,
  };
}

export function CapturedFilesList({ files, nextCursor = null, folders, members }: Props) {
  const [paginationState, dispatchPagination] = useReducer(paginationReducer, undefined, () =>
    paginationStateForProps(files, nextCursor),
  );
  const { loadedFiles, cursor } = paginationState;
  const [loadingMore, startLoadMore] = useTransition();
  const [uiState, dispatchUi] = useReducer(capturedFilesUiReducer, capturedFilesUiInitialState);

  useEffect(() => {
    dispatchPagination({ type: 'reset', files, nextCursor });
  }, [files, nextCursor]);

  const sources = useMemo(
    () => Array.from(new Set(loadedFiles.map((file) => file.provenance.source))).sort(),
    [loadedFiles],
  );
  const statuses = useMemo(
    () =>
      Array.from(
        new Set(
          loadedFiles.flatMap((file) => {
            const status = file.currentVersion?.processingStatus ?? 'pending';
            return status ? [status] : [];
          }),
        ),
      ).sort(),
    [loadedFiles],
  );
  const sourceOptions = useMemo(
    () => sources.map((source) => ({ value: source, label: source })),
    [sources],
  );
  const statusOptions = useMemo(
    () => statuses.map((status) => ({ value: status, label: status })),
    [statuses],
  );
  const typeOptions = useMemo(() => [...FILE_TYPE_OPTIONS], []);
  const activeFilterCount =
    selectedValues(uiState.sourceFilter, sourceOptions).length +
    selectedValues(uiState.typeFilter, typeOptions).length +
    selectedValues(uiState.statusFilter, statusOptions).length +
    (uiState.dateFilter !== ALL ? 1 : 0);
  const visibleFiles = loadedFiles.filter((file) => {
    const kind = fileKind(file.currentVersion?.contentType ?? null);
    const status = file.currentVersion?.processingStatus ?? 'pending';
    if (!matchesMultiFilter(file.provenance.source, uiState.sourceFilter, sourceOptions)) {
      return false;
    }
    if (!matchesMultiFilter(kind, uiState.typeFilter, typeOptions)) return false;
    if (!matchesMultiFilter(status, uiState.statusFilter, statusOptions)) return false;
    if (uiState.dateFilter !== ALL && !matchesDateFilter(file.updatedAt, uiState.dateFilter)) {
      return false;
    }
    return true;
  });

  function loadMore(): void {
    if (!cursor) return;
    startLoadMore(async () => {
      const params = new URLSearchParams({ cursor });
      const response = await fetch(`/api/documents/captured?${params.toString()}`);
      if (!response.ok) {
        toast.error('Failed to load captured files');
        return;
      }
      const page = (await response.json()) as CapturedFilesPageResponse;
      dispatchPagination({ type: 'append', files: page.items, nextCursor: page.nextCursor });
    });
  }

  if (loadedFiles.length === 0) {
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
      <div className="grid gap-3 rounded-sm border border-border bg-card p-3 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-start">
        <div className="flex min-w-0 flex-wrap items-end gap-2">
          <FilterMultiSelect
            label="Source"
            value={uiState.sourceFilter}
            onValueChange={(value) => {
              dispatchUi({ type: 'source', value });
            }}
            placeholder="All sources"
            options={sourceOptions}
          />
          <FilterMultiSelect
            label="Type"
            value={uiState.typeFilter}
            onValueChange={(value) => {
              dispatchUi({ type: 'fileType', value });
            }}
            placeholder="All types"
            options={typeOptions}
          />
          <FilterMultiSelect
            label="Status"
            value={uiState.statusFilter}
            onValueChange={(value) => {
              dispatchUi({ type: 'status', value });
            }}
            placeholder="All statuses"
            options={statusOptions}
          />
          <FilterSelect
            label="Date"
            value={uiState.dateFilter}
            onChange={(value) => {
              dispatchUi({ type: 'date', value });
            }}
          >
            <option value={ALL}>Any time</option>
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
          </FilterSelect>
        </div>
        <div className="flex flex-wrap items-center gap-2 xl:justify-end xl:pt-[1.125rem]">
          <output
            className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-dim"
            aria-live="polite"
          >
            {activeFilterCount > 0
              ? `${String(visibleFiles.length)} / ${String(loadedFiles.length)}`
              : `${String(loadedFiles.length)} visible`}
          </output>
          {activeFilterCount > 0 ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                dispatchUi({ type: 'clear_filters' });
              }}
            >
              Clear
            </Button>
          ) : null}
        </div>
      </div>

      <ul className="space-y-2">
        {visibleFiles.map((file) => (
          <CapturedFileRow
            key={file.id}
            file={file}
            onPromote={() => {
              dispatchUi({ type: 'promote', file });
            }}
          />
        ))}
      </ul>
      {visibleFiles.length === 0 ? (
        <div className="rounded-sm border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          {cursor
            ? 'No loaded captured files match these filters. Load older captures to keep searching.'
            : 'No captured files match these filters.'}
        </div>
      ) : null}
      {cursor ? (
        <Button type="button" variant="outline" size="sm" onClick={loadMore} disabled={loadingMore}>
          {loadingMore ? 'Loading…' : 'Load older captured files'}
        </Button>
      ) : null}
      {uiState.promoting ? (
        <PromoteDialog
          file={uiState.promoting}
          folders={folders}
          members={members}
          onClose={() => {
            dispatchUi({ type: 'promote', file: null });
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

function matchesMultiFilter(
  value: string,
  filter: string,
  options: readonly { value: string }[],
): boolean {
  const selected = selectedValues(filter, options);
  return selected.length === 0 || selected.includes(value);
}

function CapturedFileRow({ file, onPromote }: { file: CapturedFileItem; onPromote: () => void }) {
  const contentType = file.currentVersion?.contentType ?? '';
  const Icon = contentType.startsWith('image/') ? ImageIcon : FileText;
  const eventId = file.provenance.parentEventId ?? file.sourceRawEventId;
  const presentation = file.presentation;
  const storedName = presentation.isGeneratedName
    ? truncateFilenameMiddle(presentation.storedName)
    : null;

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
                <span
                  title={presentation.storedName}
                  className="normal-case tracking-normal text-muted-foreground"
                >
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

interface PromoteDialogState {
  name: string;
  folderId: string;
  visibility: Visibility;
  visibilityUserIds: string[];
}

type PromoteDialogAction =
  | { type: 'name'; value: string }
  | { type: 'folder'; value: string }
  | { type: 'visibility'; value: Visibility }
  | { type: 'member'; memberId: string; checked: boolean };

function promoteDialogInitialState(file: CapturedFileItem): PromoteDialogState {
  return {
    name: file.presentation.displayTitle,
    folderId: '',
    visibility: file.visibility,
    visibilityUserIds: file.visibilityUserIds ?? [],
  };
}

function promoteDialogReducer(
  state: PromoteDialogState,
  action: PromoteDialogAction,
): PromoteDialogState {
  switch (action.type) {
    case 'name':
      return { ...state, name: action.value };
    case 'folder':
      return { ...state, folderId: action.value };
    case 'visibility':
      return { ...state, visibility: action.value };
    case 'member':
      return {
        ...state,
        visibilityUserIds: action.checked
          ? Array.from(new Set([...state.visibilityUserIds, action.memberId]))
          : state.visibilityUserIds.filter((id) => id !== action.memberId),
      };
  }
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
  const [form, dispatchForm] = useReducer(promoteDialogReducer, file, promoteDialogInitialState);

  function submit(): void {
    startTransition(async () => {
      const result = await promoteCapturedFileAction({
        id: file.id,
        name: form.name,
        folderId: form.folderId || null,
        visibility: form.visibility,
        visibilityUserIds: form.visibility === 'specific_users' ? form.visibilityUserIds : [],
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
              value={form.name}
              onChange={(event) => {
                dispatchForm({ type: 'name', value: event.target.value });
              }}
              className="h-9 w-full rounded-sm border border-border bg-bg px-2 text-sm"
            />
          </label>
          <label className="block space-y-1">
            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-fg-dim">
              Folder
            </span>
            <select
              value={form.folderId}
              onChange={(event) => {
                dispatchForm({ type: 'folder', value: event.target.value });
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
              value={form.visibility}
              onChange={(event) => {
                dispatchForm({ type: 'visibility', value: event.target.value as Visibility });
              }}
              className="h-9 w-full rounded-sm border border-border bg-bg px-2 text-sm"
            >
              <option value="team">Team</option>
              <option value="private">Private</option>
              <option value="specific_users">Specific users</option>
            </select>
          </label>
          {form.visibility === 'specific_users' ? (
            <div className="max-h-36 space-y-1 overflow-auto rounded-sm border border-border p-2">
              {members.map((member) => (
                <label key={member.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={form.visibilityUserIds.includes(member.id)}
                    onChange={(event) => {
                      dispatchForm({
                        type: 'member',
                        memberId: member.id,
                        checked: event.target.checked,
                      });
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
          <Button type="button" onClick={submit} disabled={pending || !form.name.trim()}>
            {pending ? 'Promoting…' : 'Promote'}
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
  return capturedFileDateFormatter.format(new Date(value));
}
