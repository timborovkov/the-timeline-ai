'use client';

import {
  mockEvidence,
  mockupSourceLogoSrc,
  type EvidenceId,
  type MockEvidence,
} from '@/components/mockups/mockup-data';
import { ProviderLogo } from '@/components/provider-logo';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

export function CitationChip({
  evidenceId,
  className,
}: {
  evidenceId: EvidenceId;
  className?: string;
}) {
  const evidence = mockEvidence(evidenceId);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Citation ${String(evidence.number)}, ${evidence.author}, ${evidence.sourceLabel}`}
          className={cn(
            'relative -top-[0.45em] mx-px inline-flex h-[1.15em] min-w-[1.05em] items-center justify-center rounded-[3px] px-[0.22em] font-mono text-[11px] font-semibold leading-none text-signal',
            'hover:bg-signal-soft',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-strong focus-visible:ring-offset-1 focus-visible:ring-offset-bg',
            className,
          )}
        >
          <span aria-hidden="true">{String(evidence.number)}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[min(20rem,calc(100vw-1.5rem))] rounded-lg border border-border bg-surface p-3 text-fg shadow-md"
      >
        <EvidenceCard evidence={evidence} />
      </PopoverContent>
    </Popover>
  );
}

function EvidenceCard({ evidence }: { evidence: MockEvidence }) {
  return (
    <div className="space-y-2.5">
      <div className="flex items-start gap-2.5">
        <ProviderLogo
          src={mockupSourceLogoSrc(evidence.source)}
          size="xs"
          title={evidence.sourceLabel}
        />
        <div className="min-w-0 pt-px">
          <p className="truncate text-sm font-medium leading-5 text-fg">{evidence.author}</p>
          <p className="truncate font-mono text-[11px] leading-4 text-fg-dim">
            {[evidence.sourceLabel, evidence.channel, evidence.dateLabel]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
      </div>
      <p className="text-[13px] leading-5 text-fg-muted">“{evidence.quote}”</p>
      <p className="font-mono text-[11px] text-fg-dim">Example data · source evidence</p>
    </div>
  );
}

export function EvidenceRow({ evidence }: { evidence: MockEvidence }) {
  return (
    <div className="flex items-start gap-2.5 border-b border-border/80 px-2 py-2.5 sm:px-3">
      <ProviderLogo
        src={mockupSourceLogoSrc(evidence.source)}
        size="xs"
        title={evidence.sourceLabel}
      />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium leading-[1.35] text-fg">{evidence.author}</p>
        <p className="font-mono text-[11px] tabular-nums text-fg-dim">
          {[evidence.sourceLabel, evidence.channel, evidence.dateLabel].filter(Boolean).join(' · ')}
        </p>
        <p className="mt-1 text-[13px] leading-5 text-fg-muted">“{evidence.quote}”</p>
      </div>
    </div>
  );
}
