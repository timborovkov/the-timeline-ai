'use client';

import Link from 'next/link';

import type { ObjectDetail } from '@timeline/shared/objects/types';

import {
  OBJECT_BODY_CLASS,
  OBJECT_CONTROL_CLASS,
  OBJECT_MONO_META_CLASS,
  OBJECT_ROW_META_CLASS,
  OBJECT_ROW_TITLE_CLASS,
  OBJECT_SECTION_CLASS,
} from '@/components/objects/object-detail-type';
import { useWorkspaceTimezone } from '@/components/workspace-timezone-context';
import { displayText, formatDisplayDateTime } from '@/lib/display-dates';
import { cn } from '@/lib/utils';

type Provenance = ObjectDetail['provenance'];
type ProvenanceEntry = Provenance['whyThisExists'][number];

function timelinePreview(contentText: string | null, limit = 220): string {
  const cleaned = displayText(contentText ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  if (cleaned.length <= limit) return cleaned;
  return `${cleaned.slice(0, limit - 3)}...`;
}

export function ObjectOrigin({
  provenance,
  compact = false,
}: {
  provenance: Provenance | null | undefined;
  compact?: boolean;
}) {
  const why = provenance?.whyThisExists[0];
  if (!why) return null;
  const body = why.reason?.trim() ? why.reason : why.title;
  if (!body) return null;

  return (
    <section className={compact ? 'px-3 py-1.5' : undefined} aria-label="Why this exists">
      <p className={OBJECT_BODY_CLASS}>{timelinePreview(body, compact ? 220 : 360)}</p>
      <ProvenanceSourceLinks evidence={why.evidence} />
    </section>
  );
}

export function ObjectProvenanceGroups({
  provenance,
}: {
  provenance: Provenance | null | undefined;
}) {
  if (!provenance) return null;
  const groups = [
    {
      title: 'What changed it',
      sourceKind: 'change' as const,
      entries: provenance.whatChangedIt,
      previewCount: 2,
    },
    {
      title: 'Related evidence',
      sourceKind: 'related' as const,
      entries: provenance.relatedEvidence,
      previewCount: 0,
    },
  ].filter((group) => group.entries.length > 0);
  if (groups.length === 0) return null;

  return (
    <section className="space-y-2" aria-label="Provenance">
      {groups.map((group) => (
        <ProvenanceGroup
          key={group.title}
          title={group.title}
          entries={group.entries}
          previewCount={group.previewCount}
          sourceKind={group.sourceKind}
        />
      ))}
    </section>
  );
}

function ProvenanceGroup({
  title,
  entries,
  previewCount,
  sourceKind,
}: {
  title: string;
  entries: ProvenanceEntry[];
  previewCount: number;
  sourceKind: 'change' | 'related';
}) {
  const previewEntries = entries.slice(0, previewCount);
  const remainingEntries = entries.slice(previewCount);
  const remainingSourceCount = provenanceEvidenceCount(remainingEntries);
  const reviewLabel = `Review ${remainingSourceCount}${
    previewCount > 0 ? ' more' : ''
  } ${sourceKind} source${remainingSourceCount === 1 ? '' : 's'}`;

  return (
    <section className="min-w-0">
      <h2 className={OBJECT_SECTION_CLASS}>{title}</h2>
      <div className="mt-1 min-w-0">
        {previewEntries.length > 0 ? <ProvenanceEntryList entries={previewEntries} /> : null}
        {remainingEntries.length > 0 ? (
          <details className={previewEntries.length > 0 ? 'mt-1' : undefined}>
            <summary
              className={cn(
                OBJECT_CONTROL_CLASS,
                'cursor-pointer list-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/50',
              )}
            >
              {reviewLabel}
            </summary>
            <div className="mt-1 max-h-80 overflow-y-auto overscroll-contain">
              <ProvenanceEntryList entries={remainingEntries} muted />
            </div>
          </details>
        ) : null}
      </div>
    </section>
  );
}

function provenanceEvidenceCount(entries: ProvenanceEntry[]): number {
  return entries.reduce((count, entry) => count + entry.evidence.length, 0);
}

function ProvenanceEntryList({
  entries,
  muted = false,
}: {
  entries: ProvenanceEntry[];
  muted?: boolean;
}) {
  return (
    <ul className="space-y-1.5">
      {entries.map((entry) => (
        <li key={`${entry.targetKind}:${entry.operation}:${entry.id}`} className="min-w-0">
          <p
            className={cn(
              OBJECT_ROW_TITLE_CLASS,
              'line-clamp-2 break-words',
              muted && 'text-fg-muted',
            )}
          >
            {timelinePreview(entry.title, 160)}
          </p>
          {entry.reason ? (
            <p
              className={cn(OBJECT_ROW_META_CLASS, 'mt-0.5 line-clamp-2 break-words text-fg-muted')}
            >
              {displayText(entry.reason)}
            </p>
          ) : null}
          <ProvenanceSourceLinks evidence={entry.evidence} />
        </li>
      ))}
    </ul>
  );
}

function ProvenanceSourceLinks({ evidence }: { evidence: ProvenanceEntry['evidence'] }) {
  const visibleEvidence = evidence.slice(0, 3);
  const remainingEvidence = evidence.slice(3);
  return (
    <div className="mt-1 space-y-0.5">
      {visibleEvidence.map((source) => (
        <ProvenanceSourceLink key={source.rawEventId} source={source} />
      ))}
      {remainingEvidence.length > 0 ? (
        <details>
          <summary
            className={cn(
              OBJECT_CONTROL_CLASS,
              'cursor-pointer list-none text-fg-dim hover:text-fg',
            )}
          >
            Review {remainingEvidence.length} more source
            {remainingEvidence.length === 1 ? '' : 's'}
          </summary>
          <div className="mt-1.5 max-h-40 space-y-1 overflow-y-auto overscroll-contain">
            {remainingEvidence.map((source) => (
              <ProvenanceSourceLink key={source.rawEventId} source={source} />
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}

function ProvenanceSourceLink({ source }: { source: ProvenanceEntry['evidence'][number] }) {
  const timezone = useWorkspaceTimezone();
  return (
    <Link
      href={`/app/timeline?event=${source.rawEventId}#ev-${source.rawEventId}`}
      className={cn(
        OBJECT_ROW_META_CLASS,
        'block break-words text-fg-muted underline-offset-2 hover:text-fg hover:underline',
      )}
    >
      {displayText(source.source)} ·{' '}
      <span className={OBJECT_MONO_META_CLASS}>
        {formatDisplayDateTime(source.occurredAt, { timezone })}
      </span>
    </Link>
  );
}
