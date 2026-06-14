'use client';

import { ExternalLink, Link2 } from 'lucide-react';
import Link from 'next/link';
import { type ReactNode, useCallback, useMemo, useRef, useState } from 'react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

interface EvidenceLinkProps {
  eventId: string;
  children: ReactNode;
  className?: string;
  previewText?: string | null;
  source?: string | null;
  occurredAt?: string | null;
  title?: string;
}

interface TimelineEventPreview {
  id: string;
  source: string;
  contentText: string | null;
  contentAudioUrl: string | null;
  occurredAt: string;
}

interface TimelinePreviewResponse {
  items?: TimelineEventPreview[];
  audioUrls?: Record<string, string>;
}

function evidenceHref(eventId: string): string {
  return `/app/timeline?event=${eventId}#ev-${eventId}`;
}

function eventLabel(event: TimelineEventPreview | null, fallbackSource?: string | null): string {
  return event?.source ?? fallbackSource ?? 'source';
}

function occurredLabel(event: TimelineEventPreview | null, fallbackOccurredAt?: string | null) {
  const value = event?.occurredAt ?? fallbackOccurredAt;
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

export function EvidenceLink({
  eventId,
  children,
  className,
  previewText,
  source,
  occurredAt,
  title = 'Evidence',
}: EvidenceLinkProps) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<{
    loading: boolean;
    loadingEventId: string | null;
    error: string | null;
    event: TimelineEventPreview | null;
    audioUrl: string | null;
  }>({ loading: false, loadingEventId: null, error: null, event: null, audioUrl: null });
  const requestRef = useRef<AbortController | null>(null);
  const href = useMemo(() => evidenceHref(eventId), [eventId]);

  const loadEvidence = useCallback(() => {
    if (state.event?.id === eventId || (state.loading && state.loadingEventId === eventId)) return;
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setState((current) => ({
      ...current,
      loading: true,
      loadingEventId: eventId,
      error: null,
    }));
    fetch(`/api/timeline?event=${eventId}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('Could not load evidence.');
        return (await response.json()) as TimelinePreviewResponse;
      })
      .then((data) => {
        const event = data.items?.find((item) => item.id === eventId) ?? null;
        setState({
          loading: false,
          loadingEventId: null,
          error: event ? null : 'Evidence was not found.',
          event,
          audioUrl: event ? (data.audioUrls?.[event.id] ?? null) : null,
        });
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setState({
          loading: false,
          loadingEventId: null,
          error: err instanceof Error ? err.message : 'Could not load evidence.',
          event: null,
          audioUrl: null,
        });
      });
  }, [eventId, state.event, state.loading, state.loadingEventId]);

  const currentEvent = state.event?.id === eventId ? state.event : null;
  const body = currentEvent?.contentText ?? previewText ?? null;
  const meta = [occurredLabel(currentEvent, occurredAt), eventLabel(currentEvent, source)]
    .filter(Boolean)
    .join(' · ');

  return (
    <>
      <button
        type="button"
        data-evidence-href={href}
        className={cn('text-left', className)}
        onClick={() => {
          setOpen(true);
          loadEvidence();
        }}
      >
        {children}
      </button>
      <Dialog
        open={open}
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen);
          if (nextOpen) loadEvidence();
        }}
      >
        <DialogContent className="max-h-[min(760px,calc(100vh-2rem))] overflow-y-auto border-border bg-bg sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{meta || `Event ${eventId.slice(0, 8)}`}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="rounded-sm border border-border bg-surface p-4">
              {state.loading ? (
                <p className="text-sm text-muted-foreground">Loading evidence&hellip;</p>
              ) : state.error ? (
                <p className="text-sm text-danger">{state.error}</p>
              ) : body ? (
                <p className="whitespace-pre-wrap text-sm leading-6 text-fg">{body}</p>
              ) : (
                <p className="text-sm text-muted-foreground">This event has no text preview.</p>
              )}
              {state.audioUrl ? (
                <audio
                  aria-label={`Audio for evidence event ${eventId.slice(0, 8)}`}
                  controls
                  className="mt-3 w-full"
                  src={state.audioUrl}
                >
                  <track kind="captions" />
                </audio>
              ) : null}
            </div>
            <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.12em] text-fg-dim">
              <Link2 className="size-3.5" />
              <span>event {eventId.slice(0, 8)}</span>
            </div>
          </div>
          <DialogFooter>
            <Link
              href={href}
              className="inline-flex h-9 items-center justify-center gap-2 rounded-sm border border-border bg-background px-3 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              <ExternalLink className="size-4" />
              Open timeline
            </Link>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function EvidenceChip({ eventId }: { eventId: string }) {
  return (
    <EvidenceLink
      eventId={eventId}
      className={cn(
        'inline-flex items-center align-baseline font-mono text-[0.9em] leading-none',
        'rounded-sm border border-signal/30 bg-signal-soft px-1 py-0.5 text-signal transition-colors no-underline hover:bg-signal/25',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-strong focus-visible:ring-offset-1 focus-visible:ring-offset-bg',
      )}
      title="Event evidence"
    >
      <span aria-hidden="true">[ev:{eventId.slice(0, 8)}]</span>
      <span className="sr-only">Open event evidence {eventId}</span>
    </EvidenceLink>
  );
}
