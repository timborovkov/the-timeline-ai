'use client';

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

import { useWorkspaceTimezone } from '@/components/workspace-timezone-context';
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
  const timezone = useWorkspaceTimezone();
  if (!connectedWork || contextCount(connectedWork) === 0) return null;

  return (
    <section className={compact ? 'px-3 py-1.5' : undefined}>
      <h3 className="text-xs font-normal text-fg-dim">Related context</h3>
      <div className="mt-1 space-y-1.5">
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
            detail: `updated ${formatDisplayDateTime(document.updatedAt, { timezone })}`,
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
            detail: `${event.source} · ${formatDisplayDateTime(event.occurredAt, { timezone })}`,
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
      <div className="mb-0.5 flex items-center gap-1.5 text-xs font-normal text-fg-dim">
        {icon}
        <span>{title}</span>
      </div>
      <ul className="space-y-1">
        {items.map((item) => (
          <li key={item.key} className="min-w-0">
            {item.href ? (
              item.external ? (
                <a
                  href={item.href}
                  target="_blank"
                  rel="noreferrer"
                  className="flex min-w-0 items-center gap-1.5 text-sm font-normal text-fg hover:underline"
                >
                  {item.leading}
                  <span className="min-w-0 truncate">{displayText(item.label)}</span>
                  <ExternalLink className="size-3 shrink-0" aria-hidden="true" />
                </a>
              ) : (
                <Link
                  href={item.href}
                  className="flex min-w-0 items-center gap-1.5 text-sm font-normal text-fg hover:underline"
                >
                  {item.leading}
                  <span className="min-w-0 truncate">{displayText(item.label)}</span>
                </Link>
              )
            ) : (
              <span className="block truncate text-sm font-normal text-fg">
                {displayText(item.label)}
              </span>
            )}
            <div className="truncate text-xs font-normal text-fg-dim">
              {displayText(item.detail)}
            </div>
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
