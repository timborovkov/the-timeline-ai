'use client';

import { artifactRefCitation, artifactRefLabel } from '@timeline/shared/citation';
import { ExternalLink, Link2 } from 'lucide-react';
import Link from 'next/link';
import { type ReactNode, useCallback, useMemo, useRef, useState } from 'react';

import type { ArtifactPreview, ArtifactRef } from '@timeline/shared/citation';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

const CITATION_CHIP_CLASS =
  'inline-flex items-center align-baseline font-mono text-[0.9em] leading-none rounded-sm border border-signal/30 bg-signal-soft px-1 py-0.5 text-signal transition-colors no-underline hover:bg-signal/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-strong focus-visible:ring-offset-1 focus-visible:ring-offset-bg';

interface ArtifactReferenceChipProps {
  refValue: ArtifactRef;
  children?: ReactNode;
  className?: string;
  title?: string;
  initialPreview?: Partial<ArtifactPreview>;
}

interface PreviewState {
  loading: boolean;
  error: string | null;
  preview: ArtifactPreview | null;
  cacheKey: string | null;
  fetched: boolean;
}

export function ArtifactReferenceChip({
  refValue,
  children,
  className,
  title,
  initialPreview,
}: ArtifactReferenceChipProps) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<PreviewState>({
    loading: false,
    error: null,
    preview: null,
    cacheKey: null,
    fetched: false,
  });
  const requestRef = useRef<AbortController | null>(null);
  const cacheKey = useMemo(() => JSON.stringify(refValue), [refValue]);
  const label = artifactRefLabel(refValue);
  const fallbackPreview = useMemo<ArtifactPreview | null>(
    () => (initialPreview ? ({ ...initialPreview, ref: refValue } as ArtifactPreview) : null),
    [initialPreview, refValue],
  );
  const isForCurrentRef = state.cacheKey === cacheKey;
  const preview = isForCurrentRef ? (state.preview ?? fallbackPreview) : fallbackPreview;

  const loadPreview = useCallback(() => {
    if (state.cacheKey === cacheKey && (state.loading || state.fetched)) return;
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setState({
      loading: true,
      error: null,
      preview: preview,
      cacheKey,
      fetched: false,
    });
    fetch('/api/artifacts/preview', {
      body: JSON.stringify({ ref: refValue }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
      signal: controller.signal,
    })
      .then(async (response) => {
        if (response.status === 404) throw new Error('This reference is not available.');
        if (!response.ok) throw new Error('Could not load this reference.');
        return (await response.json()) as { preview?: ArtifactPreview };
      })
      .then((data) => {
        setState({
          loading: false,
          error: data.preview || fallbackPreview ? null : 'This reference is not available.',
          preview: data.preview ?? null,
          cacheKey,
          fetched: true,
        });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) {
          setState({
            loading: false,
            error: null,
            preview: null,
            cacheKey: null,
            fetched: false,
          });
          return;
        }
        setState({
          loading: false,
          error: fallbackPreview
            ? null
            : error instanceof Error
              ? error.message
              : 'Could not load this reference.',
          preview: fallbackPreview ?? null,
          cacheKey,
          fetched: true,
        });
      });
  }, [cacheKey, fallbackPreview, state.cacheKey, state.fetched, state.loading, preview, refValue]);

  return (
    <>
      <button
        type="button"
        className={cn(CITATION_CHIP_CLASS, className)}
        title={title ?? label}
        onClick={() => {
          setOpen(true);
          loadPreview();
        }}
      >
        {children ?? (
          <>
            <span aria-hidden="true">{label}</span>
            <span className="sr-only">Open reference {label}</span>
          </>
        )}
      </button>
      <ArtifactPreviewDialog
        error={isForCurrentRef ? state.error : null}
        loading={isForCurrentRef ? state.loading : false}
        open={open}
        preview={preview}
        refLabel={label}
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen);
          if (nextOpen) loadPreview();
        }}
      />
    </>
  );
}

interface ArtifactPreviewDialogProps {
  open: boolean;
  loading: boolean;
  error: string | null;
  preview: ArtifactPreview | null;
  refLabel: string;
  onOpenChange: (open: boolean) => void;
}

function ArtifactPreviewDialog({
  open,
  loading,
  error,
  preview,
  refLabel,
  onOpenChange,
}: ArtifactPreviewDialogProps) {
  const description = preview?.subtitle ?? refLabel;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="grid h-[calc(100dvh-1rem)] max-h-[860px] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden border-border bg-bg p-4 sm:h-[min(860px,calc(100dvh-2rem))] sm:max-w-3xl sm:p-6">
        <DialogHeader className="border-b border-border pb-4 pr-8">
          <DialogTitle className="text-balance">{preview?.title ?? 'Reference'}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="min-h-0 space-y-4 overflow-y-auto overscroll-contain py-4 pr-1 sm:pr-2">
          {loading ? (
            <div className="rounded-sm border border-border bg-surface p-4 text-sm text-muted-foreground">
              Loading reference…
            </div>
          ) : error ? (
            <div className="rounded-sm border border-border bg-surface p-4 text-sm text-danger">
              {error}
            </div>
          ) : preview ? (
            <>
              {preview.badges?.length ? (
                <div className="flex flex-wrap gap-1.5">
                  {preview.badges.map((badge) => (
                    <span
                      key={`${refLabel}:badge:${badge}`}
                      className="rounded-sm border border-border bg-surface px-1.5 py-0.5 text-[11px] text-fg-dim"
                    >
                      {badge}
                    </span>
                  ))}
                </div>
              ) : null}

              <div className="rounded-sm border border-border bg-surface p-4">
                {preview.body ? (
                  <p className="whitespace-pre-wrap text-sm leading-6 text-fg">{preview.body}</p>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    This reference has no text preview.
                  </p>
                )}
                {preview.media?.kind === 'audio' ? (
                  <audio
                    aria-label={preview.media.label ?? `Audio for ${refLabel}`}
                    controls
                    className="mt-3 w-full"
                    src={preview.media.url}
                  >
                    <track kind="captions" />
                  </audio>
                ) : null}
              </div>

              {preview.sections?.map((section) => (
                <section key={`${refLabel}:section:${section.title}`} className="space-y-2">
                  <h3 className="text-base font-semibold text-fg">{section.title}</h3>
                  {section.body ? (
                    <p className="whitespace-pre-wrap text-sm leading-6 text-fg">{section.body}</p>
                  ) : null}
                  {section.items?.length ? (
                    <dl className="divide-y divide-border rounded-sm border border-border bg-surface">
                      {section.items.map((item) => (
                        <div
                          key={`${refLabel}:section:${section.title}:${item.label}:${item.value}`}
                          className="grid gap-1 px-3 py-2 sm:grid-cols-[120px_1fr]"
                        >
                          <dt className="text-xs text-fg-dim">{item.label}</dt>
                          <dd className="text-sm leading-5 text-fg">{item.value}</dd>
                        </div>
                      ))}
                    </dl>
                  ) : null}
                </section>
              ))}
            </>
          ) : (
            <div className="rounded-sm border border-border bg-surface p-4 text-sm text-muted-foreground">
              Open this reference to load its preview.
            </div>
          )}

          <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.12em] text-fg-dim">
            <Link2 className="size-3.5" />
            <span>{refLabel}</span>
          </div>
        </div>

        {preview?.href ? (
          <DialogFooter className="border-t border-border pt-4">
            <Link
              href={preview.href}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-sm border border-border bg-background pl-4 pr-3.5 text-sm font-medium transition-[background-color,color,scale] duration-150 ease-out hover:bg-accent hover:text-accent-foreground active:scale-[0.96]"
            >
              <ExternalLink className="size-4" />
              Open full page
            </Link>
          </DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

export function CitationCopyChip({
  refValue,
  className,
}: {
  refValue: ArtifactRef;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const label = artifactRefLabel(refValue);
  const citation = artifactRefCitation(refValue);

  async function copyCitation() {
    const clipboard = Reflect.get(navigator, 'clipboard') as Clipboard | undefined;
    if (!clipboard?.writeText) return;
    try {
      await clipboard.writeText(citation);
    } catch {
      return;
    }
    setCopied(true);
    window.setTimeout(() => {
      setCopied(false);
    }, 1500);
  }

  return (
    <button
      type="button"
      className={cn(CITATION_CHIP_CLASS, 'normal-case', className)}
      title={copied ? `Copied ${citation}` : `Copy ${citation}`}
      onClick={() => {
        void copyCitation();
      }}
    >
      <span aria-hidden="true">{label}</span>
      <span className="sr-only">
        {copied ? `Copied citation ${label}` : `Copy citation ${label}`}
      </span>
    </button>
  );
}
