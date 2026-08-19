'use client';

import { documentKindLabel, truncateFilenameMiddle } from '@timeline/shared/documents/presentation';
import { FileText, Image as ImageIcon, Link2, Paperclip, Upload } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useMemo, useReducer, useRef, useState, useTransition } from 'react';

import type { ReactNode } from 'react';

import { promoteCapturedFileAction } from '@/app/actions/documents';
import { CollectionRow } from '@/components/collections/collection-row';
import { CollectionStatus } from '@/components/collections/collection-status';
import { CollectionToolbar } from '@/components/collections/collection-toolbar';
import { InfiniteScroll } from '@/components/collections/infinite-scroll';
import { VirtualList } from '@/components/collections/virtual-list';
import { DocumentPreview } from '@/components/documents/document-preview';
import { EmptyState } from '@/components/empty-state';
import { EvidenceLink } from '@/components/evidence-link';
import { FilterMultiSelect } from '@/components/filter-multi-select';
import { PinOverflowMenu } from '@/components/pins/pin-overflow-menu';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { ItemActionGroup } from '@/components/ui/item-actions';
import { formatCollectionCount } from '@/lib/collection-count';
import { displaySourceLabel } from '@/lib/display-labels';
import { selectedValues } from '@/lib/filter-values';
import { notifyAction } from '@/lib/notify';
import { statusLabel } from '@/lib/status-labels';

interface CapturedFileItem {
  id: string;
  name: string;
  metadata: Record<string, unknown>;
  visibility: 'team' | 'private' | 'specific_users';
  visibilityUserIds: string[] | null;
  updatedAt: string;
  pinned: boolean;
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
  loadedFiles: CapturedFileItem[];
  cursor: string | null;
}

interface PaginationAction {
  type: 'append';
  files: CapturedFileItem[];
  nextCursor: string | null;
}

function paginationStateForProps(
  files: CapturedFileItem[],
  nextCursor: string | null,
): PaginationState {
  return {
    loadedFiles: files,
    cursor: nextCursor,
  };
}

function paginationReducer(state: PaginationState, action: PaginationAction): PaginationState {
  const seen = new Set(state.loadedFiles.map((file) => file.id));
  return {
    ...state,
    loadedFiles: [...state.loadedFiles, ...action.files.filter((file) => !seen.has(file.id))],
    cursor: action.nextCursor,
  };
}

export function CapturedFilesList({ files, nextCursor = null, folders, members }: Props) {
  const [paginationState, setPaginationState] = useState(() =>
    paginationStateForProps(files, nextCursor),
  );
  const paginationInputsRef = useRef({ files, nextCursor });
  const [loadingMore, startLoadMore] = useTransition();
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  const [uiState, dispatchUi] = useReducer(capturedFilesUiReducer, capturedFilesUiInitialState);

  if (
    paginationInputsRef.current.files !== files ||
    paginationInputsRef.current.nextCursor !== nextCursor
  ) {
    paginationInputsRef.current = { files, nextCursor };
    setPaginationState(paginationStateForProps(files, nextCursor));
    setLoadMoreError(null);
  }

  const { loadedFiles, cursor } = paginationState;

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
    () => sources.map((source) => ({ value: source, label: displaySourceLabel(source) })),
    [sources],
  );
  const statusOptions = useMemo(
    () => statuses.map((status) => ({ value: status, label: processingStatusLabel(status) })),
    [statuses],
  );
  const typeOptions = useMemo(() => [...FILE_TYPE_OPTIONS], []);
  const activeFilterCount =
    selectedValues(uiState.sourceFilter, sourceOptions).length +
    selectedValues(uiState.typeFilter, typeOptions).length +
    selectedValues(uiState.statusFilter, statusOptions).length +
    (uiState.dateFilter !== ALL ? 1 : 0);
  const visibleFiles = loadedFiles.filter((file) => {
    const kind = documentKindLabel(file.currentVersion?.contentType ?? null);
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
    setLoadMoreError(null);
    startLoadMore(async () => {
      try {
        const params = new URLSearchParams({ cursor });
        const response = await fetch(`/api/documents/captured?${params.toString()}`);
        if (!response.ok) throw new Error('captured_files_load_failed');
        const page = (await response.json()) as CapturedFilesPageResponse;
        setPaginationState((state) =>
          paginationReducer(state, {
            type: 'append',
            files: page.items,
            nextCursor: page.nextCursor,
          }),
        );
      } catch {
        setLoadMoreError(
          'Could not load older captured files. The files already shown remain available. Check your connection, then try again.',
        );
      }
    });
  }

  if (loadedFiles.length === 0) {
    return (
      <EmptyState
        icon={Paperclip}
        title="No captured files yet"
        body="Attachments from conversations and connected sources appear here before you add them to Documents."
      />
    );
  }

  return (
    <section aria-label="Captured files" className="space-y-4">
      <CollectionToolbar
        activeFilters={[
          ...(uiState.sourceFilter
            ? [
                {
                  key: 'source',
                  label: 'Source',
                  value: uiState.sourceFilter,
                  onRemove: () => {
                    dispatchUi({ type: 'source', value: '' });
                  },
                },
              ]
            : []),
          ...(uiState.typeFilter
            ? [
                {
                  key: 'type',
                  label: 'Type',
                  value: uiState.typeFilter,
                  onRemove: () => {
                    dispatchUi({ type: 'fileType', value: '' });
                  },
                },
              ]
            : []),
          ...(uiState.statusFilter
            ? [
                {
                  key: 'status',
                  label: 'Status',
                  value: uiState.statusFilter,
                  onRemove: () => {
                    dispatchUi({ type: 'status', value: '' });
                  },
                },
              ]
            : []),
          ...(uiState.dateFilter !== ALL
            ? [
                {
                  key: 'date',
                  label: 'Date',
                  value: uiState.dateFilter,
                  onRemove: () => {
                    dispatchUi({ type: 'date', value: ALL });
                  },
                },
              ]
            : []),
        ]}
      >
        {cursor ? null : (
          <CollectionToolbar.Count>
            {formatCollectionCount({
              matching: visibleFiles.length,
              total: loadedFiles.length,
              filtered: activeFilterCount > 0,
            })}
          </CollectionToolbar.Count>
        )}
        <CollectionToolbar.Filters>
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
        </CollectionToolbar.Filters>
        <CollectionToolbar.Actions>
          {activeFilterCount > 0 ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                dispatchUi({ type: 'clear_filters' });
              }}
            >
              Clear all
            </Button>
          ) : null}
        </CollectionToolbar.Actions>
      </CollectionToolbar>

      <Dialog
        open={uiState.promoting !== null}
        onOpenChange={(open) => {
          if (!open) dispatchUi({ type: 'promote', file: null });
        }}
      >
        <div>
          <VirtualList
            items={visibleFiles}
            getItemKey={(file) => file.id}
            estimateSize={56}
            renderItem={(file) => (
              <CapturedFileRow
                file={file}
                onPromote={() => {
                  dispatchUi({ type: 'promote', file });
                }}
              />
            )}
          />
        </div>
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
      </Dialog>
      {visibleFiles.length === 0 ? (
        <EmptyState
          icon={Paperclip}
          size="inset"
          title="No captured files match these filters"
          body={
            cursor
              ? 'Keep scrolling to search older captures, or clear the filters to view every loaded file.'
              : 'Clear the filters to view every captured file.'
          }
        />
      ) : null}
      <InfiniteScroll
        hasMore={Boolean(cursor)}
        loading={loadingMore}
        error={loadMoreError}
        onLoadMore={loadMore}
        boundLabel="No more matching files"
      />
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
      <span className="block text-[11px] text-fg-dim">{label}</span>
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
    <div style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 52px' }}>
      <CollectionRow className="min-h-13">
        <CollectionRow.Leading>
          <span className="grid size-8 shrink-0 place-items-center rounded-sm bg-surface-2 text-fg-muted">
            <Icon aria-hidden="true" className="size-4" />
          </span>
        </CollectionRow.Leading>
        <CollectionRow.Title>
          <span className="min-w-0">
            <span
              className="block truncate text-sm font-semibold leading-5 text-fg"
              title={presentation.displayTitle}
            >
              {presentation.displayTitle}
            </span>
            <span
              className="mt-0.5 block truncate text-xs text-fg-dim"
              title={storedName ?? undefined}
            >
              {fileTypeLabel(contentType)}
              {storedName ? (
                <span
                  title={presentation.storedName}
                  className="font-mono normal-case tracking-normal text-fg-dim"
                >
                  {' '}
                  · stored as {storedName}
                </span>
              ) : null}
            </span>
          </span>
        </CollectionRow.Title>
        <CollectionRow.Context>
          {file.description ?? fileTypeLabel(contentType)}
        </CollectionRow.Context>
        <CollectionRow.Metadata>
          <>
            <Badge variant="secondary" className="text-[11px] text-fg-muted">
              {displaySourceLabel(file.provenance.source)}
            </Badge>
            <CollectionStatus
              value={file.currentVersion?.processingStatus ?? 'pending'}
              label={processingStatusLabel(file.currentVersion?.processingStatus ?? 'pending')}
            />
            <Badge variant="outline" className="text-[11px] text-fg-muted">
              {visibilityLabel(file.visibility)}
            </Badge>
            <span className="text-xs tabular-nums text-fg-dim">
              Updated {formatDate(file.updatedAt)}
            </span>
          </>
        </CollectionRow.Metadata>
        <CollectionRow.Actions>
          <ItemActionGroup label={`Actions for ${presentation.displayTitle}`}>
            <PinOverflowMenu
              target={{ kind: 'document', key: file.id }}
              title={presentation.displayTitle}
              initialPinned={file.pinned}
            />
            {file.currentVersion?.id &&
            ['image', 'pdf', 'audio'].includes(documentKindLabel(contentType)) ? (
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
                className="inline-flex h-8 items-center gap-1 rounded-sm border border-signal/30 bg-signal-soft px-2 font-mono text-[10px] text-signal transition-colors hover:border-signal/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal focus-visible:ring-offset-2"
              >
                <Link2 aria-hidden="true" className="size-3.5" />
                View evidence
              </EvidenceLink>
            ) : null}
            <DialogTrigger asChild>
              <Button type="button" variant="outline" size="sm" onClick={onPromote}>
                <Upload aria-hidden="true" className="mr-2 size-4" />
                Promote
              </Button>
            </DialogTrigger>
          </ItemActionGroup>
        </CollectionRow.Actions>
      </CollectionRow>
    </div>
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
  const [titleError, setTitleError] = useState<string | null>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);

  function submit(): void {
    if (!form.name.trim()) {
      setTitleError('Enter a title before promoting this file.');
      titleInputRef.current?.focus();
      return;
    }

    setTitleError(null);
    startTransition(async () => {
      const result = await notifyAction({
        id: `captured-file:${file.id}:promote`,
        loading: 'Promoting captured file…',
        success: 'Promoted to documents',
        error: 'Couldn’t promote captured file',
        run: async () => {
          const promoted = await promoteCapturedFileAction({
            id: file.id,
            name: form.name,
            folderId: form.folderId || null,
            visibility: form.visibility,
            visibilityUserIds: form.visibility === 'specific_users' ? form.visibilityUserIds : [],
          });
          if (!promoted.ok || !promoted.documentId) {
            return { error: promoted.error ?? 'Couldn’t promote captured file' };
          }
          return { documentId: promoted.documentId };
        },
      });
      if (result.error || !('documentId' in result) || !result.documentId) return;
      router.push(`/app/documents/${result.documentId}`);
    });
  }

  return (
    <DialogContent
      className="max-h-[calc(100dvh-2rem)] overflow-y-auto border-border bg-bg p-4 sm:max-w-lg"
      showCloseButton={!pending}
      onEscapeKeyDown={(event) => {
        if (pending) event.preventDefault();
      }}
      onPointerDownOutside={(event) => {
        if (pending) event.preventDefault();
      }}
    >
      <DialogHeader>
        <DialogTitle>Promote to Documents</DialogTitle>
        <DialogDescription>
          Create a document from this captured file. Choose its title, location, and visibility.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-3" aria-busy={pending}>
        <label className="block space-y-1">
          <span className="text-[11px] text-fg-dim">Title</span>
          <input
            ref={titleInputRef}
            name="title"
            autoComplete="off"
            disabled={pending}
            value={form.name}
            aria-required="true"
            aria-invalid={Boolean(titleError)}
            aria-describedby={titleError ? 'captured-file-title-error' : undefined}
            onChange={(event) => {
              const value = event.target.value;
              dispatchForm({ type: 'name', value });
              if (value.trim()) setTitleError(null);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !pending) submit();
            }}
            className="h-9 w-full rounded-sm border border-border bg-bg px-2 text-base focus-visible:border-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/40 focus-visible:ring-offset-2 focus-visible:ring-offset-bg sm:text-sm"
          />
        </label>
        {titleError ? (
          <p id="captured-file-title-error" className="text-sm text-danger" aria-live="polite">
            {titleError}
          </p>
        ) : null}
        <label className="block space-y-1">
          <span className="text-[11px] text-fg-dim">Save in</span>
          <select
            name="folder"
            disabled={pending}
            value={form.folderId}
            onChange={(event) => {
              dispatchForm({ type: 'folder', value: event.target.value });
            }}
            className="h-9 w-full rounded-sm border border-border bg-bg px-2 text-base focus-visible:border-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/40 focus-visible:ring-offset-2 focus-visible:ring-offset-bg sm:text-sm"
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
          <span className="text-[11px] text-fg-dim">Who can view it</span>
          <select
            name="visibility"
            disabled={pending}
            value={form.visibility}
            onChange={(event) => {
              dispatchForm({ type: 'visibility', value: event.target.value as Visibility });
            }}
            className="h-9 w-full rounded-sm border border-border bg-bg px-2 text-base focus-visible:border-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/40 focus-visible:ring-offset-2 focus-visible:ring-offset-bg sm:text-sm"
          >
            <option value="team">Everyone on the team</option>
            <option value="private">Only you</option>
            <option value="specific_users">Specific people</option>
          </select>
        </label>
        {form.visibility === 'specific_users' ? (
          <fieldset className="max-h-36 space-y-1 overflow-auto rounded-sm border border-border p-2">
            <legend className="px-1 text-[11px] text-fg-dim">Share with</legend>
            {members.map((member) => (
              <label key={member.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  disabled={pending}
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
          </fieldset>
        ) : null}
        <DialogFooter className="mt-5">
          <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="button" onClick={submit} disabled={pending}>
            {pending ? 'Promoting…' : 'Promote'}
          </Button>
        </DialogFooter>
      </div>
    </DialogContent>
  );
}

function matchesDateFilter(value: string, filter: string): boolean {
  if (filter === ALL) return true;
  const days = filter === '7d' ? 7 : 30;
  return Date.now() - new Date(value).getTime() <= days * 24 * 60 * 60 * 1000;
}

function formatDate(value: string): string {
  return capturedFileDateFormatter.format(new Date(value));
}

function fileTypeLabel(contentType: string): string {
  const labels = {
    image: 'Image',
    pdf: 'PDF',
    audio: 'Audio',
    file: 'File',
  } as const;
  return labels[documentKindLabel(contentType)];
}

function processingStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    pending: 'Waiting to process',
    extracting: 'Extracting text',
    chunked: 'Ready for search',
    embedded: 'Ready',
    deferred: 'Processing deferred',
    failed: 'Needs attention',
  };
  return labels[status] ?? statusLabel(status);
}

function visibilityLabel(visibility: Visibility): string {
  if (visibility === 'team') return 'Team visibility';
  if (visibility === 'private') return 'Only you';
  return 'Selected people';
}
