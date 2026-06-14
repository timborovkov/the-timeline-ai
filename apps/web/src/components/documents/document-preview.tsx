'use client';

import { Eye, Loader2 } from 'lucide-react';
import Image from 'next/image';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import { getDocumentPreviewUrlAction } from '@/app/actions/documents';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type DocumentPreviewHandle =
  | { documentId: string; versionId?: string | null; versionNumber?: number | null }
  | { documentId?: string | null; versionId: string; versionNumber?: number | null };

interface PreviewState {
  url: string;
  filename: string;
  contentType: string | null;
  mediaKind: 'image' | 'audio';
}

interface Props {
  target: DocumentPreviewHandle;
  label?: string;
  className?: string;
  compact?: boolean;
}

export function DocumentPreview({ target, label = 'Preview', className, compact = false }: Props) {
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [pending, startTransition] = useTransition();

  function openPreview(): void {
    startTransition(async () => {
      const res = await getDocumentPreviewUrlAction({
        documentId: target.documentId ?? undefined,
        versionId: target.versionId ?? undefined,
        versionNumber: target.versionNumber ?? undefined,
      });
      if (!res.ok || !res.url || !res.mediaKind) {
        toast.error(res.error ?? 'Preview unavailable');
        return;
      }
      setPreview({
        url: res.url,
        filename: res.filename ?? 'Attachment',
        contentType: res.contentType ?? null,
        mediaKind: res.mediaKind,
      });
    });
  }

  return (
    <div className={cn('min-w-0', className)}>
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
        {pending ? 'Opening...' : preview ? 'Refresh preview' : label}
      </Button>

      {preview ? (
        <div className="mt-3 min-w-0 overflow-hidden rounded-sm border border-border bg-bg">
          {preview.mediaKind === 'image' ? (
            <div className="relative flex h-[70vh] min-h-72 max-h-[48rem] w-full items-center justify-center">
              {/* Presigned S3/RustFS URLs include auth query params, so they load directly in the browser instead of through Next's image pipeline. */}
              <Image
                src={preview.url}
                alt={preview.filename}
                fill
                unoptimized
                sizes="100vw"
                className="object-contain"
              />
            </div>
          ) : (
            <div className="p-3">
              <audio
                src={preview.url}
                controls
                preload="metadata"
                aria-label={preview.filename}
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
