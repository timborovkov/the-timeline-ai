import { truncateFilenameMiddle } from '@timeline/shared/documents/presentation';
import {
  ExternalLink,
  FileText,
  ImageIcon,
  LinkIcon,
  MessageSquareText,
  Paperclip,
} from 'lucide-react';
import Link from 'next/link';

import type { ObjectDetail } from '@timeline/shared/objects/types';
import type { ReactNode } from 'react';

import { displayText, formatDisplayDateTime } from '@/lib/display-dates';

type ConnectedWork = ObjectDetail['connectedWork'];

function mediaKind(contentType: string | null): 'image' | 'pdf' | 'audio' | 'file' {
  if (!contentType) return 'file';
  if (contentType.startsWith('image/')) return 'image';
  if (contentType === 'application/pdf') return 'pdf';
  if (contentType.startsWith('audio/')) return 'audio';
  return 'file';
}

function contextCount(connectedWork: ConnectedWork): number {
  return (
    connectedWork.links.length +
    connectedWork.documents.length +
    connectedWork.capturedFiles.length +
    connectedWork.timelineEvents.length
  );
}

export function ObjectRelatedContext({
  connectedWork,
  compact = false,
}: {
  connectedWork: ConnectedWork | null | undefined;
  compact?: boolean;
}) {
  if (!connectedWork || contextCount(connectedWork) === 0) return null;

  return (
    <section className="border-b border-border p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-xs text-fg-dim">Related context</h3>
        <span className="text-[11px] text-fg-dim">{contextCount(connectedWork)}</span>
      </div>
      <div className={compact ? 'space-y-3' : 'grid gap-3 sm:grid-cols-2'}>
        <ContextGroup
          title="Links"
          icon={<LinkIcon className="size-3.5" aria-hidden="true" />}
          items={connectedWork.links.slice(0, compact ? 4 : 6).map((link) => ({
            key: link.id,
            label: link.displayUrl ?? link.canonicalName,
            detail: link.provider ?? link.domain ?? 'shared link',
            href: link.canonicalUrl,
            external: Boolean(link.canonicalUrl),
          }))}
        />
        <ContextGroup
          title="Documents"
          icon={<FileText className="size-3.5" aria-hidden="true" />}
          items={connectedWork.documents.slice(0, compact ? 3 : 6).map((document) => ({
            key: document.id,
            label: truncateFilenameMiddle(document.name),
            detail: `updated ${formatDisplayDateTime(document.updatedAt)}`,
            href: `/app/documents/${document.id}`,
          }))}
        />
        <ContextGroup
          title="Files"
          icon={<Paperclip className="size-3.5" aria-hidden="true" />}
          items={connectedWork.capturedFiles.slice(0, compact ? 3 : 6).map((file) => {
            const kind = mediaKind(file.contentType);
            return {
              key: file.id,
              label: truncateFilenameMiddle(file.name),
              detail: file.contentType ?? 'captured file',
              href: '/app/documents/captured',
              leading:
                kind === 'image' ? <ImageIcon className="size-3" aria-hidden="true" /> : null,
            };
          })}
        />
        <ContextGroup
          title="Timeline"
          icon={<MessageSquareText className="size-3.5" aria-hidden="true" />}
          items={connectedWork.timelineEvents.slice(0, compact ? 3 : 6).map((event) => ({
            key: event.id,
            label: timelinePreview(event.contentText),
            detail: `${event.source} · ${formatDisplayDateTime(event.occurredAt)}`,
            href: `/app/timeline?event=${event.id}#ev-${event.id}`,
          }))}
        />
      </div>
    </section>
  );
}

function ContextGroup({
  title,
  icon,
  items,
}: {
  title: string;
  icon: ReactNode;
  items: {
    key: string;
    label: string;
    detail: string;
    href: string | null;
    external?: boolean;
    leading?: ReactNode;
  }[];
}) {
  if (items.length === 0) return null;

  return (
    <div className="min-w-0">
      <div className="mb-1.5 flex items-center gap-1.5 text-[11px] text-fg-dim">
        {icon}
        <span>{title}</span>
      </div>
      <ul className="space-y-1.5">
        {items.map((item) => (
          <li key={item.key} className="rounded-sm border border-border bg-surface px-2.5 py-2">
            {item.href ? (
              item.external ? (
                <a
                  href={item.href}
                  target="_blank"
                  rel="noreferrer"
                  className="flex min-w-0 items-center gap-1.5 text-sm font-medium hover:underline"
                >
                  {item.leading}
                  <span className="min-w-0 truncate">{displayText(item.label)}</span>
                  <ExternalLink className="size-3 shrink-0" aria-hidden="true" />
                </a>
              ) : (
                <Link
                  href={item.href}
                  className="flex min-w-0 items-center gap-1.5 text-sm font-medium hover:underline"
                >
                  {item.leading}
                  <span className="min-w-0 truncate">{displayText(item.label)}</span>
                </Link>
              )
            ) : (
              <span className="block truncate text-sm font-medium">{displayText(item.label)}</span>
            )}
            <div className="mt-1 truncate text-[11px] text-fg-dim">{displayText(item.detail)}</div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function timelinePreview(contentText: string | null): string {
  const cleaned = displayText(contentText ?? 'Timeline event')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.length <= 120 ? cleaned : `${cleaned.slice(0, 117)}...`;
}
