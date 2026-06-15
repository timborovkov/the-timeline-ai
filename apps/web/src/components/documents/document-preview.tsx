'use client';

import { Eye, Loader2 } from 'lucide-react';
import Image from 'next/image';
import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { toast } from 'sonner';

import { getDocumentPreviewUrlAction } from '@/app/actions/documents';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type DocumentPreviewHandle =
  | { documentId: string; versionId?: string | null; versionNumber?: number | null }
  | { documentId?: string | null; versionId: string; versionNumber?: number | null };

interface PreviewState {
  key: string;
  url: string;
  filename: string;
  contentType: string | null;
  mediaKind: 'image' | 'audio' | 'pdf';
}

interface Props {
  target: DocumentPreviewHandle;
  label?: string;
  className?: string;
  compact?: boolean;
  autoLoad?: boolean;
  showButton?: boolean;
}

export function DocumentPreview({
  target,
  label = 'Preview',
  className,
  compact = false,
  autoLoad = false,
  showButton = true,
}: Props) {
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [pending, startTransition] = useTransition();
  const loadedKeyRef = useRef<string | null>(null);
  const inFlightKeyRef = useRef<string | null>(null);
  const requestSeqRef = useRef(0);
  const targetKey = `${target.documentId ?? ''}:${target.versionId ?? ''}:${
    target.versionNumber ?? ''
  }`;

  const openPreview = useCallback((): void => {
    const requestKey = targetKey;
    const requestSeq = requestSeqRef.current + 1;
    requestSeqRef.current = requestSeq;
    inFlightKeyRef.current = requestKey;
    startTransition(async () => {
      const requestIsCurrent =
        requestSeqRef.current === requestSeq && inFlightKeyRef.current === requestKey;
      if (!requestIsCurrent) return;
      // react-doctor-disable-next-line react-doctor/async-defer-await -- The current-request guard directly above is the fast skip path before signing.
      const res = await getDocumentPreviewUrlAction({
        documentId: target.documentId ?? undefined,
        versionId: target.versionId ?? undefined,
        versionNumber: target.versionNumber ?? undefined,
      });
      if (requestSeqRef.current !== requestSeq || inFlightKeyRef.current !== requestKey) return;
      inFlightKeyRef.current = null;
      if (!res.ok || !res.url || !res.mediaKind) {
        if (loadedKeyRef.current === requestKey) loadedKeyRef.current = null;
        toast.error(res.error ?? 'Preview unavailable');
        return;
      }
      loadedKeyRef.current = requestKey;
      setPreview({
        key: requestKey,
        url: res.url,
        filename: res.filename ?? 'Attachment',
        contentType: res.contentType ?? null,
        mediaKind: res.mediaKind,
      });
    });
  }, [target.documentId, target.versionId, target.versionNumber, targetKey]);

  useEffect(() => {
    if (!autoLoad || loadedKeyRef.current === targetKey || inFlightKeyRef.current === targetKey) {
      return;
    }
    // react-doctor-disable-next-line react-doctor/no-derived-state -- Auto-preview fetches a signed URL as a mount side effect; it is not copying props into state.
    openPreview();
  }, [autoLoad, openPreview, targetKey]);

  const activePreview = preview?.key === targetKey ? preview : null;

  return (
    <div className={cn('min-w-0', className)}>
      {showButton ? (
        <Button
          type="button"
          size={compact ? 'sm' : 'default'}
          variant="outline"
          onClick={openPreview}
          disabled={pending}
          className="gap-1.5"
        >
          {pending ? (
            <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
          ) : (
            <Eye aria-hidden="true" className="size-3.5" />
          )}
          {pending ? 'Opening…' : activePreview ? 'Refresh preview' : label}
        </Button>
      ) : pending ? (
        <div className="flex min-h-48 items-center justify-center rounded-sm border border-border bg-bg text-sm text-muted-foreground">
          <Loader2 aria-hidden="true" className="mr-2 size-4 animate-spin" />
          Loading preview…
        </div>
      ) : null}

      {activePreview ? (
        <div
          className={cn(
            'min-w-0 overflow-hidden rounded-sm border border-border bg-bg',
            showButton ? 'mt-3' : '',
          )}
        >
          {activePreview.mediaKind === 'image' ? (
            <div className="relative flex h-[58vh] min-h-72 max-h-[42rem] w-full items-center justify-center">
              {/* Presigned S3/RustFS URLs include auth query params, so they load directly in the browser instead of through Next's image pipeline. */}
              <Image
                src={activePreview.url}
                alt={activePreview.filename}
                fill
                unoptimized
                sizes="100vw"
                className="object-contain"
              />
            </div>
          ) : activePreview.mediaKind === 'pdf' ? (
            <object
              data={activePreview.url}
              type="application/pdf"
              aria-label={activePreview.filename}
              className="h-[72vh] min-h-96 w-full bg-bg"
            >
              <iframe
                src={activePreview.url}
                title={activePreview.filename}
                referrerPolicy="no-referrer"
                className="h-[72vh] w-full"
              />
            </object>
          ) : (
            <div className="p-3">
              <audio
                src={activePreview.url}
                controls
                preload="metadata"
                aria-label={activePreview.filename}
                className="w-full"
              >
                <track kind="captions" src="data:text/vtt,WEBVTT" srcLang="en" label="Captions" />
              </audio>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
