'use client';

import { FileText, Image as ImageIcon, Link2, Upload } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { toast } from 'sonner';

import { promoteCapturedFileAction } from '@/app/actions/documents';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

interface CapturedFileItem {
  id: string;
  name: string;
  visibility: string;
  updatedAt: string;
  sourceRawEventId: string | null;
  currentVersion: {
    contentType: string | null;
    byteSize: number | null;
    processingStatus: string;
  } | null;
  provenance: {
    source: string;
    parentEventId: string | null;
    occurredAt: string | null;
    summary: string | null;
  };
}

export function CapturedFilesList({ files }: { files: CapturedFileItem[] }) {
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
    <ul className="space-y-2">
      {files.map((file) => (
        <CapturedFileRow key={file.id} file={file} />
      ))}
    </ul>
  );
}

function CapturedFileRow({ file }: { file: CapturedFileItem }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const contentType = file.currentVersion?.contentType ?? '';
  const Icon = contentType.startsWith('image/') ? ImageIcon : FileText;
  const eventId = file.provenance.parentEventId ?? file.sourceRawEventId;

  function promote(): void {
    startTransition(async () => {
      const result = await promoteCapturedFileAction({ id: file.id });
      if (!result.ok) {
        toast.error(result.error ?? 'Promotion failed');
        return;
      }
      toast.success('Promoted to document drive');
      router.refresh();
    });
  }

  return (
    <li className="grid gap-3 rounded-sm border border-border bg-card p-3 md:grid-cols-[minmax(0,1fr)_auto]">
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-sm border border-border bg-surface-2 text-muted-foreground">
            <Icon className="size-4" />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold text-foreground">
              {file.name}
            </span>
            <span className="mt-0.5 block font-mono text-[11px] uppercase tracking-[0.12em] text-fg-dim">
              {contentType || 'captured file'}
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
        </div>
      </div>
      <div className="flex items-center justify-end gap-2">
        {eventId ? (
          <Link
            href={`/app/timeline?event=${eventId}#ev-${eventId}`}
            className="inline-flex h-8 items-center gap-1 rounded-sm border border-border px-2 font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground"
          >
            <Link2 className="size-3.5" />
            Event
          </Link>
        ) : null}
        <Button type="button" size="sm" onClick={promote} disabled={pending}>
          <Upload className="mr-2 size-4" />
          Promote
        </Button>
      </div>
    </li>
  );
}
