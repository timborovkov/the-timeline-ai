'use client';

import { type InfiniteData, useQueryClient } from '@tanstack/react-query';
import { Lock, Send, Users } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { type SyntheticEvent, useEffect, useRef, useState } from 'react';

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

export function CaptureForm({ initialVisibility = 'team', currentUser, filters = {} }: Props) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const formRef = useRef<HTMLFormElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [isPrivate, setIsPrivate] = useState(initialVisibility === 'private');
  const [clip, setClip] = useState<RecordedClip | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'success' | 'warning'; message: string } | null>(
    null,
  );
  // Bumped on successful post; passed as `key` to AudioRecorder so React
  // remounts it with a fresh `phase: 'idle'` / `clip: null` state. The
  // recorder owns its own clip state internally; without remount it would
  // still show the post-recording audio player + Discard button.
  const [recorderKey, setRecorderKey] = useState(0);
  // setPending is async; a quick double-click could enter submit twice before
  // the button disables. Same in-flight latch the old AudioRecorder used.
  const inFlightRef = useRef(false);

  useEffect(() => {
    setHydrated(true);
  }, []);

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
      { queryKey: queryKeys.timeline(filters), exact: true },
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
      { queryKey: queryKeys.timeline(filters), exact: true },
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
    const req = await requestAudioUploadAction(base);
    if (!req.ok || !req.url || !req.key) {
      throw new Error(req.error ?? 'Upload request failed');
    }
    const put = await fetch(req.url, {
      method: 'PUT',
      headers: { 'content-type': req.contentType ?? base },
      body: clip.blob,
    });
    if (!put.ok) throw new Error(`Upload failed: ${put.status}`);
    const create = await createAudioEventAction({
      key: req.key,
      mimeType: base,
      durationSec: clip.durationSec,
      visibility: isPrivate ? 'private' : 'team',
    });
    if (!create.ok) throw new Error(create.error ?? 'Save failed');
    return create.warning ?? null;
  }

  async function handleSubmit(e: SyntheticEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    if (inFlightRef.current) return;
    const text = (textareaRef.current?.value ?? '').trim();
    if (!clip && text.length === 0) {
      setError('Write something or record a voice note.');
      return;
    }
    inFlightRef.current = true;
    setPending(true);
    setError(null);
    setNotice(null);
    let optimisticTextId: string | null = null;
    let textCommitted = false;
    const warnings: string[] = [];
    try {
      // Text + voice in the same Post become two separate events on the
      // timeline. We deliberately do NOT pack typed text into the audio
      // row's content_text: the transcribe worker overwrites that column
      // with the transcript on completion (transcribe.ts), which would
      // silently destroy the user's note.
      //
      // Two-step submit: if the text event succeeds but the audio upload
      // then fails, clear the textarea immediately so a retry only resubmits
      // the audio. Otherwise the user clicks Post again and we'd duplicate
      // the (already-committed) text event on the timeline.
      if (text.length > 0) {
        optimisticTextId = addOptimisticTextEvent(text);
        const result = await submitTextOnly(text);
        if (!result.ok) {
          throw new Error(result.error ?? 'Post failed');
        }
        if (result.warning) warnings.push(result.warning);
        textCommitted = true;
        if (textareaRef.current) textareaRef.current.value = '';
      }
      const hadClip = clip !== null;
      if (clip) {
        const audioWarning = await submitAudio();
        if (audioWarning) warnings.push(audioWarning);
      }
      formRef.current?.reset();
      // Only clear clip / remount the recorder when an audio clip was
      // actually posted. A text-only Post must not touch recorder state —
      // the user may have started (or finished) a recording during the
      // async text submit. The Stop button stays enabled while pending, so
      // `onstop` can fire mid-submit and push a fresh clip up via
      // onClipChange; unconditionally nulling here would overwrite that
      // clip in the parent while the child still shows it in review,
      // wedging the user (next Post sees no clip).
      if (hadClip) {
        setClip(null);
        setRecorderKey((k) => k + 1);
      }
      // Keep visibility pill sticky — it's a preference, not per-post.
      setNotice({
        tone: warnings.length > 0 ? 'warning' : 'success',
        message:
          warnings.length > 0
            ? warnings.join(' ')
            : 'Saved to the timeline. Processing will add search, facts, and citations when available.',
      });
      await queryClient.invalidateQueries({ queryKey: queryKeys.onboarding() });
      router.refresh();
    } catch (err) {
      if (!textCommitted && optimisticTextId) {
        removeOptimisticTextEvent(optimisticTextId);
      } else if (textCommitted) {
        router.refresh();
      }
      setError(err instanceof Error ? err.message : 'Post failed');
      setNotice(null);
    } finally {
      inFlightRef.current = false;
      setPending(false);
    }
  }

  return (
    <form
      ref={formRef}
      onSubmit={handleSubmit}
      data-capture-ready={hydrated ? 'true' : 'false'}
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
      <AudioRecorder key={recorderKey} onClipChange={setClip} disabled={pending} />
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/60 pt-4">
        <button
          type="button"
          onClick={() => {
            setIsPrivate((v) => !v);
          }}
          className={cn(
            'inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs transition-colors',
            isPrivate
              ? 'border-primary/30 bg-primary/10 text-primary'
              : 'border-border bg-transparent text-muted-foreground hover:text-foreground',
          )}
          aria-pressed={isPrivate}
        >
          {isPrivate ? <Lock className="h-3 w-3" /> : <Users className="h-3 w-3" />}
          {isPrivate ? 'Private (only me)' : 'Visible to team'}
        </button>
        <div className="flex items-center gap-3">
          {error ? <span className="text-xs text-destructive">{error}</span> : null}
          <Button type="submit" disabled={pending} className="gap-2">
            {pending ? (
              clip ? (
                'Uploading…'
              ) : (
                'Posting…'
              )
            ) : (
              <>
                <Send className="h-3.5 w-3.5" />
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
