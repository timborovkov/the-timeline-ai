'use client';

import { ChevronDown } from 'lucide-react';
import { useId, useState } from 'react';
import { toast } from 'sonner';

import { CollectionGroup } from '@/components/collections/collection-group';
import { EvidenceRow } from '@/components/mockups/citation-chip';
import {
  MILESTONES,
  NORTHSTAR_NEEDS_YOU,
  NORTHSTAR_SUMMARY,
  RAW_EVENTS,
  mockEvidence,
  mockPerson,
  mockupSourceLogoSrc,
} from '@/components/mockups/mockup-data';
import { PersonChip, ProjectChip } from '@/components/mockups/person-chip';
import { ProviderLogo } from '@/components/provider-logo';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type HistoryView = 'milestones' | 'events';

export function MilestoneHistory() {
  const [view, setView] = useState<HistoryView>('milestones');
  const toggleId = useId();

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-medium text-fg-dim">Company · example data</p>
          <h1 className="text-lg font-semibold leading-snug tracking-tight text-fg">
            Northstar Works
          </h1>
          <p className="mt-1 text-sm text-fg-muted">
            Design partner on <ProjectChip projectId="pilot" /> · contact{' '}
            <PersonChip personId="elena" />
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status="in_progress" label="Pilot" />
          <Button
            size="sm"
            onClick={() => {
              toast.success('Prep pack ready · example data · Elena Park');
            }}
          >
            Prep me
          </Button>
        </div>
      </header>

      <section
        aria-labelledby="northstar-summary-heading"
        className="rounded-lg border border-border bg-surface px-4 py-4"
      >
        <h2 id="northstar-summary-heading" className="text-base font-semibold text-fg">
          Summary
        </h2>
        <p className="mt-2 max-w-[70ch] text-sm leading-[1.65] text-fg">{NORTHSTAR_SUMMARY}</p>
        <p className="mt-3 text-sm text-fg">
          <span className="font-medium">Needs you. </span>
          <span className="text-fg-muted">{NORTHSTAR_NEEDS_YOU}</span>
        </p>
      </section>

      <div
        role="tablist"
        aria-label="Northstar history"
        className="flex w-fit items-center rounded-sm border border-border bg-surface p-0.5"
      >
        <ViewTab
          controls={`${toggleId}-milestones`}
          selected={view === 'milestones'}
          onSelect={() => {
            setView('milestones');
          }}
        >
          Milestones
        </ViewTab>
        <ViewTab
          controls={`${toggleId}-events`}
          selected={view === 'events'}
          onSelect={() => {
            setView('events');
          }}
        >
          All events
        </ViewTab>
      </div>

      {view === 'milestones' ? (
        <div id={`${toggleId}-milestones`} role="tabpanel">
          <ol className="border-t border-border">
            {MILESTONES.map((milestone) => (
              <li key={milestone.id} className="border-b border-border/80">
                <details className="group">
                  <summary className="flex min-h-11 cursor-pointer list-none items-start gap-3 px-2 py-3 marker:hidden sm:items-center sm:px-3">
                    <ChevronDown
                      aria-hidden="true"
                      className="mt-0.5 size-3.5 shrink-0 text-fg-dim transition-transform duration-150 group-open:rotate-0 group-[:not(:open)]:rotate-[-90deg] motion-reduce:transition-none"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium leading-5 text-fg">{milestone.title}</p>
                      <p className="text-[13px] leading-5 text-fg-muted">{milestone.summary}</p>
                    </div>
                    <span className="shrink-0 font-mono text-[11px] tabular-nums text-fg-dim">
                      {milestone.when}
                    </span>
                  </summary>
                  <div className="border-t border-border/80 bg-surface/70">
                    <p className="px-3 py-2 text-xs font-medium text-fg-muted">Evidence</p>
                    {milestone.evidenceIds.map((evidenceId) => (
                      <EvidenceRow key={evidenceId} evidence={mockEvidence(evidenceId)} />
                    ))}
                  </div>
                </details>
              </li>
            ))}
          </ol>
        </div>
      ) : (
        <div id={`${toggleId}-events`} role="tabpanel">
          <CollectionGroup title="Source events" count={RAW_EVENTS.length} tone="neutral">
            <ul>
              {RAW_EVENTS.map((event) => (
                <li
                  key={event.id}
                  className="flex min-h-11 items-center gap-3 border-b border-border/80 px-2 py-1.5 sm:px-3"
                >
                  <ProviderLogo
                    src={mockupSourceLogoSrc(event.source)}
                    size="xs"
                    title={event.source}
                  />
                  <span className="w-[7.5rem] shrink-0 font-mono text-[11px] tabular-nums text-fg-dim">
                    {event.time}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm text-fg underline decoration-fg-dim underline-offset-2">
                    {event.title}
                  </span>
                </li>
              ))}
            </ul>
          </CollectionGroup>
          <p className="mt-3 text-xs text-fg-dim">
            Raw timeline is still here. Milestones are the default so the record is scannable.
          </p>
        </div>
      )}

      <aside className="rounded-lg border border-border bg-surface px-4 py-4">
        <h2 className="text-[13px] font-semibold tracking-[-0.01em] text-fg">Properties</h2>
        <dl className="mt-3 space-y-2 text-sm">
          <div className="flex gap-3">
            <dt className="w-[6.75rem] shrink-0 text-xs font-medium text-fg-dim">Status</dt>
            <dd className="text-fg">Pilot</dd>
          </div>
          <div className="flex gap-3">
            <dt className="w-[6.75rem] shrink-0 text-xs font-medium text-fg-dim">Owner</dt>
            <dd className="text-fg">{mockPerson('casey').name}</dd>
          </div>
          <div className="flex gap-3">
            <dt className="w-[6.75rem] shrink-0 text-xs font-medium text-fg-dim">Contact</dt>
            <dd className="text-fg">{mockPerson('elena').name}</dd>
          </div>
          <div className="flex gap-3">
            <dt className="w-[6.75rem] shrink-0 text-xs font-medium text-fg-dim">Sources</dt>
            <dd className="text-fg-muted">Slack · Email · Calls</dd>
          </div>
        </dl>
      </aside>
    </div>
  );
}

function ViewTab({
  children,
  controls,
  onSelect,
  selected,
}: {
  children: string;
  controls: string;
  onSelect: () => void;
  selected: boolean;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-controls={controls}
      aria-selected={selected}
      onClick={onSelect}
      className={cn(
        'rounded-sm px-3 py-1.5 text-sm font-medium transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        selected ? 'bg-signal-soft text-fg' : 'text-fg-muted hover:text-fg',
      )}
    >
      {children}
    </button>
  );
}
