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
  void previewText;
  const fallbackTitle = [source, occurredAt].filter(Boolean).join(' · ');

  return (
    <ArtifactReferenceChip
      refValue={{ kind: 'timeline_event', id: eventId }}
      className={cn('text-left', className)}
      title={title || fallbackTitle || 'Event evidence'}
    >
      {children}
    </ArtifactReferenceChip>
  );
}
