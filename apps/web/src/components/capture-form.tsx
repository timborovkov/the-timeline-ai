'use client';

import { type InfiniteData, useQueryClient } from '@tanstack/react-query';
import {
  FileAudio,
  FileText,
  Image as ImageIcon,
  Lock,
  Paperclip,
  Send,
  Users,
  X,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { type Dispatch, type RefObject, type SyntheticEvent, useReducer, useRef } from 'react';

import {
  finalizeDocumentVersionAction,
  requestDocumentUploadAction,
} from '@/app/actions/documents';
import {
  createAudioEventAction,
  createTextEventAction,
  requestAudioUploadAction,
  type CreateEventState,
} from '@/app/actions/events';
import { AudioRecorder, type RecordedClip } from '@/components/audio-recorder';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { notifyAction, type ActionResult } from '@/lib/notify';
import { queryKeys } from '@/lib/query-keys';
import { type TimelineEvent, type TimelinePage } from '@/lib/use-paginated-queries';
import { cn } from '@/lib/utils';

function baseMimeType(mt: string): string {
  return mt.split(';')[0]?.trim() ?? mt;
}

function mimeTypeForAudioFile(file: File): string | null {
  const type = baseMimeType(file.type || '');
  if (type.startsWith('audio/')) return type;
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'm4a') return 'audio/mp4';
  if (ext === 'mp3') return 'audio/mpeg';
  if (ext === 'ogg' || ext === 'oga') return 'audio/ogg';
  if (ext === 'wav') return 'audio/wav';
  if (ext === 'aac') return 'audio/aac';
  if (ext === 'flac') return 'audio/flac';
  return null;
}

function SelectedFileIcon({ file }: { file: File }) {
  const audioType = mimeTypeForAudioFile(file);
  if (audioType) return <FileAudio className="size-3.5" />;
  if (file.type.startsWith('image/')) return <ImageIcon className="size-3.5" />;
  return <FileText className="size-3.5" />;
}

interface AttachmentPickerProps {
  files: File[];
  pending: boolean;
  fileInputRef: RefObject<HTMLInputElement | null>;
  onAddFiles: (files: File[]) => void;
  onRemoveFile: (index: number) => void;
}

function AttachmentPicker({
  files,
  pending,
  fileInputRef,
  onAddFiles,
  onRemoveFile,
}: AttachmentPickerProps) {
  return (
    <div className="rounded-sm border border-border bg-surface p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="gap-2"
          disabled={pending}
          onClick={() => fileInputRef.current?.click()}
        >
          <Paperclip className="size-3.5" />
          Attach
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          aria-label="Attach files"
          onChange={(event) => {
            onAddFiles(Array.from(event.currentTarget.files ?? []));
            event.currentTarget.value = '';
          }}
        />
        {files.length === 0 ? (
          <span className="text-xs text-fg-muted">Audio, images, PDFs, docs, and notes</span>
        ) : (
          files.map((file, index) => (
            <span
              key={`${file.name}-${String(file.size)}-${String(index)}`}
              className="inline-flex max-w-full items-center gap-2 rounded-sm border border-border bg-bg px-2.5 py-1 text-xs text-fg-muted"
            >
              <SelectedFileIcon file={file} />
              <span className="max-w-48 truncate">{file.name}</span>
              <button
                type="button"
                className="grid size-6 place-items-center rounded-sm text-fg-muted transition-colors hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
                disabled={pending}
                onClick={() => {
                  onRemoveFile(index);
                }}
                aria-label={`Remove ${file.name}`}
              >
                <X className="size-3" />
              </button>
            </span>
          ))
        )}
      </div>
    </div>
  );
}

interface Props {
  initialVisibility?: 'team' | 'private';
  currentUser: { id: string; name: string | null; email: string };
  filters?: {
    author?: string | null;
    from?: string | null;
    to?: string | null;
    source?: string | null;
    impact?: string | null;
  };
}

type CaptureFilters = NonNullable<Props['filters']>;

const EMPTY_FILTERS: CaptureFilters = {};

interface CaptureUiState {
  isPrivate: boolean;
  clip: RecordedClip | null;
  files: File[];
  pending: boolean;
  error: string | null;
  recorderKey: number;
}

type CaptureUiAction = Partial<CaptureUiState> | ((state: CaptureUiState) => CaptureUiState);

function initCaptureUiState(
  initialVisibility: NonNullable<Props['initialVisibility']>,
): CaptureUiState {
  return {
    isPrivate: initialVisibility === 'private',
    clip: null,
    files: [],
    pending: false,
    error: null,
    recorderKey: 0,
  };
}

function captureUiReducer(state: CaptureUiState, action: CaptureUiAction): CaptureUiState {
  return typeof action === 'function' ? action(state) : { ...state, ...action };
}

function filterAllowsEvent(
  filters: CaptureFilters,
  event: Pick<TimelineEvent, 'authorUserId' | 'occurredAt' | 'source'>,
): boolean {
  if (filters.author && filters.author !== event.authorUserId) return false;
  if (filters.source && filters.source !== event.source) return false;
  if (filters.impact) return false;
  const occurredAt = new Date(event.occurredAt).getTime();
  if (filters.from && occurredAt < new Date(filters.from).getTime()) return false;
  if (filters.to && occurredAt >= new Date(filters.to).getTime() + 24 * 60 * 60 * 1000) {
    return false;
  }
  return true;
}

async function uploadAudioBlob(input: {
  blob: Blob;
  mimeType: string;
  visibility: 'private' | 'team';
  noteText?: string;
  durationSec?: number;
}): Promise<string | null> {
  const req = await requestAudioUploadAction(input.mimeType);
  if (!req.ok || !req.url || !req.key) {
    throw new Error(req.error ?? 'Upload request failed');
  }
  const put = await fetch(req.url, {
    method: 'PUT',
    headers: { 'content-type': req.contentType ?? input.mimeType },
    body: input.blob,
  });
  if (!put.ok) throw new Error(`Upload failed: ${put.status}`);
  const create = await createAudioEventAction({
    key: req.key,
    mimeType: input.mimeType,
    noteText: input.noteText,
    durationSec: input.durationSec,
    visibility: input.visibility,
  });
  if (!create.ok) throw new Error(create.error ?? 'Save failed');
  return create.warning ?? null;
}

async function uploadDocumentFile(file: File, visibility: 'private' | 'team'): Promise<void> {
  const contentType = file.type || 'application/octet-stream';
  const req = await requestDocumentUploadAction({
    name: file.name,
    filename: file.name,
    contentType,
    visibility,
    visibilityUserIds: [],
  });
  if (!req.ok || !req.url || !req.versionId) {
    throw new Error(req.error ?? `Upload request failed for ${file.name}`);
  }
  if (req.maxBytes && file.size > req.maxBytes) {
    throw new Error(
      `${file.name} exceeds ${String(Math.round(req.maxBytes / 1024 / 1024))} MiB limit`,
    );
  }
  const put = await fetch(req.url, {
    method: 'PUT',
    headers: { 'content-type': contentType },
    body: file,
  });
  if (!put.ok) throw new Error(`Upload failed for ${file.name}: ${put.status}`);
  const finalized = await finalizeDocumentVersionAction({ versionId: req.versionId });
  if (!finalized.ok) throw new Error(finalized.error ?? `Finalize failed for ${file.name}`);
}

interface CaptureSubmissionOptions {
  currentUser: Props['currentUser'];
  filters: CaptureFilters;
  isPrivate: boolean;
  clip: RecordedClip | null;
  files: File[];
  formRef: RefObject<HTMLFormElement | null>;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  fileInputRef: RefObject<HTMLInputElement | null>;
  setCaptureUi: Dispatch<CaptureUiAction>;
}

function useCaptureSubmission({
  currentUser,
  filters,
  isPrivate,
  clip,
  files,
  formRef,
  textareaRef,
  fileInputRef,
  setCaptureUi,
}: CaptureSubmissionOptions) {
  const router = useRouter();
  const queryClient = useQueryClient();
  // Prevent a fast double-submit before React applies the pending state.
  const inFlightRef = useRef(false);
  const visibility = isPrivate ? 'private' : 'team';

  async function submitTextOnly(text: string): Promise<CreateEventState> {
    const fd = new FormData();
    fd.set('text', text);
    fd.set('visibility', visibility);
    return createTextEventAction({}, fd);
  }

  function addOptimisticTextEvent(text: string): string | null {
    const now = new Date().toISOString();
    const event: TimelineEvent = {
      id: `optimistic-${crypto.randomUUID()}`,
      teamId: 'optimistic',
      authorUserId: currentUser.id,
      source: 'web',
      contentText: text,
      contentAudioUrl: null,
      occurredAt: now,
      createdAt: now,
      visibility,
      visibilityUserIds: null,
      visibilityOwnerUserId: currentUser.id,
      sourceMetadata: { optimistic: true },
    };
    if (!filterAllowsEvent(filters, event)) return null;
    queryClient.setQueriesData<InfiniteData<TimelinePage, string | null>>(
      { queryKey: queryKeys.timeline(filters) },
      (previous) => {
        if (!previous?.pages[0]) return previous;
        const first = previous.pages[0];
        return {
          ...previous,
          pages: [
            {
              ...first,
              items: [event, ...first.items],
              authors: {
                ...first.authors,
                [currentUser.id]: currentUser,
              },
            },
            ...previous.pages.slice(1),
          ],
        };
      },
    );
    return event.id;
  }

  function removeOptimisticTextEvent(id: string): void {
    queryClient.setQueriesData<InfiniteData<TimelinePage, string | null>>(
      { queryKey: queryKeys.timeline(filters) },
      (previous) => {
        if (!previous) return previous;
        return {
          ...previous,
          pages: previous.pages.map((page) => ({
            ...page,
            items: page.items.filter((event) => event.id !== id),
          })),
        };
      },
    );
  }

  async function submitAudio(): Promise<string | null> {
    if (!clip) throw new Error('No clip to upload');
    const base = baseMimeType(clip.mimeType);
    const noteText = (textareaRef.current?.value ?? '').trim();
    return uploadAudioBlob({
      blob: clip.blob,
      mimeType: base,
      ...(noteText ? { noteText } : {}),
      durationSec: clip.durationSec,
      visibility,
    });
  }

  return async function handleSubmit(event: SyntheticEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (inFlightRef.current) return;
    const text = (textareaRef.current?.value ?? '').trim();
    if (!clip && files.length === 0 && text.length === 0) {
      setCaptureUi({ error: 'Write something, record a voice note, or attach a file.' });
      textareaRef.current?.focus();
      return;
    }
    inFlightRef.current = true;
    setCaptureUi({ pending: true, error: null });
    const progress = {
      optimisticTextId: null as string | null,
      textCommitted: false,
      serverStateChanged: false,
    };
    const warnings: string[] = [];
    const outcome = { success: 'Saved to the timeline' };
    try {
      const result = await notifyAction({
        id: 'capture:post',
        loading: clip || files.length > 0 ? 'Uploading…' : 'Posting…',
        get success() {
          return outcome.success;
        },
        error: 'Couldn’t save to the timeline',
        run: async (): Promise<ActionResult> => {
          if (text.length > 0 && !clip) {
            progress.optimisticTextId = addOptimisticTextEvent(text);
            const posted = await submitTextOnly(text);
            if (!posted.ok) throw new Error(posted.error ?? 'Post failed');
            if (posted.warning) warnings.push(posted.warning);
            progress.textCommitted = true;
            progress.serverStateChanged = true;
            if (textareaRef.current) textareaRef.current.value = '';
          }
          if (clip) {
            const audioWarning = await submitAudio();
            if (audioWarning) warnings.push(audioWarning);
            progress.serverStateChanged = true;
            if (textareaRef.current) textareaRef.current.value = '';
            setCaptureUi((current) =>
              current.clip === clip
                ? {
                    ...current,
                    clip: null,
                    recorderKey: current.recorderKey + 1,
                  }
                : current,
            );
          }
          const attachmentResults = await Promise.allSettled(
            files.map(async (file) => {
              const audioType = mimeTypeForAudioFile(file);
              if (audioType) {
                return uploadAudioBlob({ blob: file, mimeType: audioType, visibility });
              }
              await uploadDocumentFile(file, visibility);
              return null;
            }),
          );
          const failedFiles: File[] = [];
          const failureMessages: string[] = [];
          const attachmentWarnings = attachmentResults.flatMap((attachment, index) => {
            if (attachment.status === 'fulfilled') {
              progress.serverStateChanged = true;
              return attachment.value ? [attachment.value] : [];
            }
            const failedFile = files[index];
            if (failedFile) failedFiles.push(failedFile);
            failureMessages.push(
              attachment.reason instanceof Error
                ? attachment.reason.message
                : `Upload failed for ${failedFile?.name ?? 'file'}`,
            );
            return [];
          });
          warnings.push(
            ...attachmentWarnings.filter((warning): warning is string => Boolean(warning)),
          );
          if (failedFiles.length > 0) {
            setCaptureUi({ files: failedFiles });
            throw new Error(failureMessages[0] ?? 'Upload failed');
          }
          if (warnings.length > 0) outcome.success = warnings.join(' ');
          formRef.current?.reset();
          if (fileInputRef.current) fileInputRef.current.value = '';
          setCaptureUi({ files: [] });
          await queryClient.invalidateQueries({ queryKey: queryKeys.onboarding() });
          router.refresh();
          return { ok: true };
        },
      });
      if (result.error) {
        if (!progress.textCommitted && progress.optimisticTextId) {
          removeOptimisticTextEvent(progress.optimisticTextId);
        } else if (progress.serverStateChanged) {
          router.refresh();
        }
      }
    } finally {
      inFlightRef.current = false;
      setCaptureUi({ pending: false });
    }
  };
}

interface CaptureFieldsProps {
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  // A successful audio capture remounts the recorder to clear its owned clip state.
  recorderKey: number;
  pending: boolean;
  files: File[];
  fileInputRef: RefObject<HTMLInputElement | null>;
  onClipChange: (clip: RecordedClip | null) => void;
  onAddFiles: (files: File[]) => void;
  onRemoveFile: (index: number) => void;
}

function CaptureFields({
  textareaRef,
  recorderKey,
  pending,
  files,
  fileInputRef,
  onClipChange,
  onAddFiles,
  onRemoveFile,
}: CaptureFieldsProps) {
  return (
    <>
      <div className="flex items-baseline gap-x-3 text-xs text-fg-dim">
        <span className="text-fg">Capture</span>
        <span aria-hidden="true">·</span>
        <span>Quick note, meeting takeaway, decision, or follow-up</span>
      </div>
      <label htmlFor="capture-note" className="sr-only">
        Note
      </label>
      <Textarea
        ref={textareaRef}
        id="capture-note"
        name="text"
        placeholder="What happened?"
        rows={3}
        autoFocus
        className="resize-none rounded-sm border-0 bg-transparent p-0 text-base leading-7 shadow-none ring-0 ring-offset-0 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:text-sm"
      />
      <AudioRecorder key={recorderKey} onClipChange={onClipChange} disabled={pending} />
      <AttachmentPicker
        files={files}
        pending={pending}
        fileInputRef={fileInputRef}
        onAddFiles={onAddFiles}
        onRemoveFile={onRemoveFile}
      />
    </>
  );
}

interface CaptureFooterProps {
  isPrivate: boolean;
  pending: boolean;
  isUploading: boolean;
  error: string | null;
  onToggleVisibility: () => void;
}

function CaptureFooter({
  isPrivate,
  pending,
  isUploading,
  error,
  onToggleVisibility,
}: CaptureFooterProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/60 pt-4">
      <button
        type="button"
        onClick={onToggleVisibility}
        className={cn(
          'inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
          isPrivate
            ? 'border-signal/30 bg-signal-soft text-fg'
            : 'border-border bg-transparent text-fg-muted hover:text-fg',
        )}
        aria-pressed={isPrivate}
      >
        {isPrivate ? <Lock className="size-3" /> : <Users className="size-3" />}
        {isPrivate ? 'Private (only me)' : 'Visible to team'}
      </button>
      <div className="flex items-center gap-3">
        {error ? (
          <p role="alert" className="text-xs text-danger">
            {error}
          </p>
        ) : null}
        <Button type="submit" disabled={pending} className="gap-2">
          {pending ? (
            isUploading ? (
              'Uploading…'
            ) : (
              'Posting…'
            )
          ) : (
            <>
              <Send className="size-3.5" />
              Post
            </>
          )}
        </Button>
      </div>
    </div>
  );
}

export function CaptureForm({
  initialVisibility = 'team',
  currentUser,
  filters = EMPTY_FILTERS,
}: Props) {
  const formRef = useRef<HTMLFormElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [{ isPrivate, clip, files, pending, error, recorderKey }, setCaptureUi] = useReducer(
    captureUiReducer,
    initialVisibility,
    initCaptureUiState,
  );
  const handleSubmit = useCaptureSubmission({
    currentUser,
    filters,
    isPrivate,
    clip,
    files,
    formRef,
    textareaRef,
    fileInputRef,
    setCaptureUi,
  });

  return (
    <form
      ref={formRef}
      onSubmit={handleSubmit}
      data-capture-ready="true"
      className="space-y-4 sm:space-y-5"
    >
      <CaptureFields
        textareaRef={textareaRef}
        recorderKey={recorderKey}
        pending={pending}
        files={files}
        fileInputRef={fileInputRef}
        onClipChange={(nextClip) => {
          setCaptureUi({ clip: nextClip });
        }}
        onAddFiles={(nextFiles) => {
          setCaptureUi((current) => ({ ...current, files: [...current.files, ...nextFiles] }));
        }}
        onRemoveFile={(index) => {
          setCaptureUi((current) => ({
            ...current,
            files: current.files.filter((_, fileIndex) => fileIndex !== index),
          }));
        }}
      />
      <CaptureFooter
        isPrivate={isPrivate}
        pending={pending}
        isUploading={Boolean(clip) || files.length > 0}
        error={error}
        onToggleVisibility={() => {
          setCaptureUi((current) => ({ ...current, isPrivate: !current.isPrivate }));
        }}
      />
    </form>
  );
}
