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
import { type RefObject, type SyntheticEvent, useReducer, useRef } from 'react';

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
    <div className="rounded-sm border border-dashed border-border/70 p-3">
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
          <span className="text-xs text-muted-foreground">
            Audio, images, PDFs, docs, and notes
          </span>
        ) : (
          files.map((file, index) => (
            <span
              key={`${file.name}-${String(file.size)}-${String(index)}`}
              className="inline-flex max-w-full items-center gap-2 rounded-full border border-border bg-background px-2.5 py-1 text-xs text-muted-foreground"
            >
              <SelectedFileIcon file={file} />
              <span className="max-w-48 truncate">{file.name}</span>
              <button
                type="button"
                className="text-muted-foreground transition-colors hover:text-foreground"
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
  notice: { tone: 'success' | 'warning'; message: string } | null;
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
    notice: null,
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

export function CaptureForm({
  initialVisibility = 'team',
  currentUser,
  filters = EMPTY_FILTERS,
}: Props) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const formRef = useRef<HTMLFormElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [{ isPrivate, clip, files, pending, error, notice, recorderKey }, setCaptureUi] =
    useReducer(captureUiReducer, initialVisibility, initCaptureUiState);
  // Bumped on successful post; passed as `key` to AudioRecorder so React
  // remounts it with a fresh `phase: 'idle'` / `clip: null` state. The
  // recorder owns its own clip state internally; without remount it would
  // still show the post-recording audio player + Discard button.
  // setPending is async; a quick double-click could enter submit twice before
  // the button disables. Same in-flight latch the old AudioRecorder used.
  const inFlightRef = useRef(false);

  async function submitTextOnly(text: string): Promise<CreateEventState> {
    const fd = new FormData();
    fd.set('text', text);
    fd.set('visibility', isPrivate ? 'private' : 'team');
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
      visibility: isPrivate ? 'private' : 'team',
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
      visibility: isPrivate ? 'private' : 'team',
    });
  }

  async function handleSubmit(e: SyntheticEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    if (inFlightRef.current) return;
    const text = (textareaRef.current?.value ?? '').trim();
    if (!clip && files.length === 0 && text.length === 0) {
      setCaptureUi({ error: 'Write something, record a voice note, or attach a file.' });
      return;
    }
    inFlightRef.current = true;
    setCaptureUi({ pending: true, error: null, notice: null });
    let optimisticTextId: string | null = null;
    let textCommitted = false;
    let serverStateChanged = false;
    const warnings: string[] = [];
    try {
      if (text.length > 0 && !clip) {
        optimisticTextId = addOptimisticTextEvent(text);
        const result = await submitTextOnly(text);
        if (!result.ok) {
          throw new Error(result.error ?? 'Post failed');
        }
        if (result.warning) warnings.push(result.warning);
        textCommitted = true;
        serverStateChanged = true;
        if (textareaRef.current) textareaRef.current.value = '';
      }
      if (clip) {
        const audioWarning = await submitAudio();
        if (audioWarning) warnings.push(audioWarning);
        serverStateChanged = true;
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
            return uploadAudioBlob({
              blob: file,
              mimeType: audioType,
              visibility: isPrivate ? 'private' : 'team',
            });
          }
          await uploadDocumentFile(file, isPrivate ? 'private' : 'team');
          return null;
        }),
      );
      const failedFiles: File[] = [];
      const failureMessages: string[] = [];
      const attachmentWarnings = attachmentResults.flatMap((result, index) => {
        if (result.status === 'fulfilled') {
          serverStateChanged = true;
          return result.value ? [result.value] : [];
        }
        const failedFile = files[index];
        if (failedFile) failedFiles.push(failedFile);
        failureMessages.push(
          result.reason instanceof Error
            ? result.reason.message
            : `Upload failed for ${failedFile?.name ?? 'file'}`,
        );
        return [];
      });
      warnings.push(...attachmentWarnings.filter((warning): warning is string => Boolean(warning)));
      if (failedFiles.length > 0) {
        setCaptureUi({ files: failedFiles });
        throw new Error(failureMessages[0] ?? 'Upload failed');
      }
      formRef.current?.reset();
      if (fileInputRef.current) fileInputRef.current.value = '';
      setCaptureUi({ files: [] });
      // Keep visibility pill sticky — it's a preference, not per-post.
      setCaptureUi({
        notice: {
          tone: warnings.length > 0 ? 'warning' : 'success',
          message:
            warnings.length > 0
              ? warnings.join(' ')
              : 'Saved to the timeline. Processing will add search, facts, and citations when available.',
        },
      });
      await queryClient.invalidateQueries({ queryKey: queryKeys.onboarding() });
      router.refresh();
    } catch (err) {
      if (!textCommitted && optimisticTextId) {
        removeOptimisticTextEvent(optimisticTextId);
      } else if (serverStateChanged) {
        router.refresh();
      }
      setCaptureUi({ error: err instanceof Error ? err.message : 'Post failed', notice: null });
    } finally {
      inFlightRef.current = false;
      setCaptureUi({ pending: false });
    }
  }

  return (
    <form
      ref={formRef}
      onSubmit={handleSubmit}
      data-capture-ready="true"
      className="space-y-4 sm:space-y-5"
    >
      <div className="flex items-baseline gap-x-3 font-mono text-[11px] uppercase tracking-[0.14em] text-fg-dim">
        <span className="text-fg">CAPTURE</span>
        <span className="text-fg-dim">·</span>
        <span>quick note · meeting takeaway · decision · follow-up</span>
      </div>
      <Textarea
        ref={textareaRef}
        name="text"
        placeholder="What happened?"
        rows={3}
        className="resize-none rounded-md border-0 bg-transparent p-0 text-[15px] leading-7 shadow-none ring-0 ring-offset-0 transition-colors focus-visible:ring-0 focus-visible:ring-offset-0 focus-visible:[outline:none]"
      />
      <AudioRecorder
        key={recorderKey}
        onClipChange={(nextClip) => {
          setCaptureUi({ clip: nextClip });
        }}
        disabled={pending}
      />
      <AttachmentPicker
        files={files}
        pending={pending}
        fileInputRef={fileInputRef}
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
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/60 pt-4">
        <button
          type="button"
          onClick={() => {
            setCaptureUi((current) => ({ ...current, isPrivate: !current.isPrivate }));
          }}
          className={cn(
            'inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs transition-colors',
            isPrivate
              ? 'border-primary/30 bg-primary/10 text-primary'
              : 'border-border bg-transparent text-muted-foreground hover:text-foreground',
          )}
          aria-pressed={isPrivate}
        >
          {isPrivate ? <Lock className="size-3" /> : <Users className="size-3" />}
          {isPrivate ? 'Private (only me)' : 'Visible to team'}
        </button>
        <div className="flex items-center gap-3">
          {error ? <span className="text-xs text-destructive">{error}</span> : null}
          <Button type="submit" disabled={pending} className="gap-2">
            {pending ? (
              clip || files.length > 0 ? (
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
      {notice ? (
        <p
          role="status"
          className={cn(
            'rounded-sm border px-3 py-2 text-xs leading-5',
            notice.tone === 'warning'
              ? 'border-danger/30 bg-danger/5 text-danger'
              : 'border-signal/30 bg-signal-soft text-fg',
          )}
        >
          {notice.message}
        </p>
      ) : null}
    </form>
  );
}
