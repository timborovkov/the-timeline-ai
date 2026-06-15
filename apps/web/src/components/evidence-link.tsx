'use client';

import { type ReactNode } from 'react';

import { ArtifactReferenceChip } from '@/components/artifact-reference-chip';
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

export function EvidenceLink({
  eventId,
  children,
  className,
  previewText,
  source,
  occurredAt,
  title = 'Event evidence',
}: EvidenceLinkProps) {
  const fallbackTitle = [source, occurredAt].filter(Boolean).join(' · ');
  const initialPreview =
    previewText || source || occurredAt
      ? {
          title,
          subtitle: fallbackTitle || 'Event evidence',
          body: previewText,
        }
      : undefined;

  return (
    <ArtifactReferenceChip
      refValue={{ kind: 'timeline_event', id: eventId }}
      className={cn('text-left', className)}
      title={title || fallbackTitle || 'Event evidence'}
      initialPreview={initialPreview}
    >
      {children}
    </ArtifactReferenceChip>
  );
}
