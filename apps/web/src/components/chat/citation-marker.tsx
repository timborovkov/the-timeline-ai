'use client';

import {
  citationQuote,
  resolveArtifactPreviewActions,
  type ArtifactPreview,
  type ArtifactRef,
} from '@timeline/shared/citation';
import {
  CalendarDays,
  ExternalLink,
  FileText,
  Mail,
  MessageSquareText,
  Mic,
  NotebookText,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useId, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';

import { ProviderLogo } from '@/components/provider-logo';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useArtifactPreview } from '@/components/use-artifact-preview';
import { citationLogoSrc } from '@/lib/citation-source';
import { cn } from '@/lib/utils';

interface Props {
  number: number;
  refValue: ArtifactRef;
}

const FALLBACK_ICON: Record<string, LucideIcon> = {
  calendar: CalendarDays,
  calendar_event: CalendarDays,
  document: FileText,
  document_chunk: FileText,
  email: Mail,
  meeting: Mic,
  slack: MessageSquareText,
  telegram: MessageSquareText,
  web: NotebookText,
};

function canHover(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(hover: hover) and (pointer: fine)').matches
  );
}

export function CitationMarker({ number, refValue }: Props) {
  const cardId = useId();
  const [open, setOpen] = useState(false);
  const hoverTimer = useRef<number>(0);
  const pointerInside = useRef(false);
  const ignoreNextClose = useRef(false);
  const openedByFocus = useRef(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const { error, loadPreview, loading, preview } = useArtifactPreview(refValue);
  const accessibleName = citationAccessibleName(number, preview);

  function openCard() {
    setOpen(true);
    loadPreview();
  }

  function closeCard() {
    window.clearTimeout(hoverTimer.current);
    pointerInside.current = false;
    openedByFocus.current = false;
    setOpen(false);
  }

  function scheduleClose() {
    window.clearTimeout(hoverTimer.current);
    hoverTimer.current = window.setTimeout(() => {
      if (pointerInside.current) return;
      const active = document.activeElement;
      if (triggerRef.current?.contains(active) || contentRef.current?.contains(active)) return;
      setOpen(false);
    }, 120);
  }

  function handleOpenChange(next: boolean) {
    if (!next && ignoreNextClose.current) {
      ignoreNextClose.current = false;
      return;
    }
    if (next) {
      openCard();
      return;
    }
    closeCard();
  }

  function handleMouseEnter() {
    if (!canHover()) return;
    pointerInside.current = true;
    window.clearTimeout(hoverTimer.current);
    hoverTimer.current = window.setTimeout(openCard, 70);
  }

  function handleMouseLeave() {
    if (!canHover()) return;
    pointerInside.current = false;
    scheduleClose();
  }

  function handleClick(event: MouseEvent<HTMLButtonElement>) {
    if (canHover()) {
      event.preventDefault();
      openCard();
      return;
    }
    if (openedByFocus.current) {
      openedByFocus.current = false;
      ignoreNextClose.current = true;
      openCard();
      return;
    }
    if (open) closeCard();
    else openCard();
  }

  function handleTriggerKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeCard();
      return;
    }
    if (event.key === 'Tab' && !event.shiftKey && open) {
      const link = contentRef.current?.querySelector('a');
      if (link instanceof HTMLElement) {
        event.preventDefault();
        link.focus();
      }
    }
  }

  function handleContentKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeCard();
      triggerRef.current?.focus();
    }
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange} modal={false}>
      <PopoverTrigger asChild>
        <button
          ref={triggerRef}
          type="button"
          aria-controls={cardId}
          aria-expanded={open}
          aria-haspopup="dialog"
          aria-label={accessibleName}
          className={cn(
            'relative -top-[0.45em] mx-px inline-flex h-[1.15em] min-w-[1.05em] items-center justify-center rounded-[3px] px-[0.22em] font-mono text-[11px] font-semibold leading-none text-signal',
            'hover:bg-signal-soft',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-strong focus-visible:ring-offset-1 focus-visible:ring-offset-bg',
          )}
          onClick={handleClick}
          onBlur={(event) => {
            const next = event.relatedTarget as Node | null;
            if (contentRef.current?.contains(next) || triggerRef.current?.contains(next)) return;
            if (pointerInside.current) return;
            scheduleClose();
          }}
          onFocus={() => {
            openedByFocus.current = true;
            openCard();
          }}
          onKeyDown={handleTriggerKeyDown}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
        >
          <span aria-hidden="true">{String(number)}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        ref={contentRef}
        id={cardId}
        align="start"
        role="dialog"
        aria-label={accessibleName}
        side="bottom"
        sideOffset={6}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
        }}
        onEscapeKeyDown={() => {
          closeCard();
          triggerRef.current?.focus();
        }}
        onKeyDown={handleContentKeyDown}
        onMouseEnter={() => {
          pointerInside.current = true;
          window.clearTimeout(hoverTimer.current);
        }}
        onMouseLeave={handleMouseLeave}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
        }}
        className="w-[min(20rem,calc(100vw-1.5rem))] rounded-lg border border-border bg-surface p-3 text-fg shadow-md"
      >
        <CitationPreviewCard error={error} loading={loading} number={number} preview={preview} />
      </PopoverContent>
    </Popover>
  );
}

function CitationPreviewCard({
  error,
  loading,
  number,
  preview,
}: {
  error: string | null;
  loading: boolean;
  number: number;
  preview: ArtifactPreview | null;
}) {
  if (loading && !preview) {
    return (
      <div className="space-y-2" aria-busy="true">
        <div className="flex gap-2.5">
          <div className="size-6 rounded-sm border border-border bg-white" />
          <div className="min-w-0 flex-1 space-y-1.5 pt-0.5">
            <div className="h-3 w-28 rounded-sm bg-surface-2" />
            <div className="h-2.5 w-20 rounded-sm bg-surface-2" />
          </div>
        </div>
        <div className="h-3 w-full rounded-sm bg-surface-2" />
        <p className="sr-only">Loading citation {String(number)}</p>
      </div>
    );
  }

  if (error && !preview) {
    return <p className="text-sm text-danger">{error}</p>;
  }

  if (!preview) {
    return <p className="text-sm text-fg-muted">Open this citation to load its source.</p>;
  }

  const card = citationCardModel(preview);
  const actions = resolveArtifactPreviewActions(preview);
  const primary = actions.find((action) => action.primary) ?? actions[0];
  const rest = actions.filter((action) => action !== primary);

  return (
    <div className="space-y-2.5">
      <div className="flex items-start gap-2.5">
        <SourceMark
          logoSrc={card.logoSrc}
          sourceKey={card.sourceKey}
          sourceLabel={card.sourceLabel}
        />
        <div className="min-w-0 pt-px">
          <p className="truncate text-sm font-medium leading-5 text-fg">
            {card.author ?? card.sourceLabel}
          </p>
          <p className="truncate font-mono text-[11px] leading-4 text-fg-dim">
            {[card.author ? card.sourceLabel : null, card.dateLabel].filter(Boolean).join(' · ')}
          </p>
        </div>
      </div>
      {card.quote ? (
        <p className="truncate text-[13px] leading-5 text-fg-muted">“{card.quote}”</p>
      ) : (
        <p className="text-[13px] leading-5 text-fg-dim">No quoted text for this source.</p>
      )}
      {primary ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <SourceLink
            action={primary}
            className="inline-flex items-center gap-1 text-sm font-medium text-signal hover:underline"
          />
          {rest.map((action) => (
            <SourceLink
              key={`${action.label}:${action.href}`}
              action={action}
              className="inline-flex items-center gap-1 text-xs text-fg-muted hover:text-fg hover:underline"
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function citationCardModel(preview: ArtifactPreview): {
  sourceKey: string;
  sourceLabel: string;
  logoSrc: string | null;
  author: string | null;
  dateLabel: string | null;
  quote: string | null;
} {
  if (preview.card) return preview.card;
  return {
    sourceKey: preview.ref.kind,
    sourceLabel: preview.badges?.[0] ?? 'Source',
    logoSrc: citationLogoSrc({ kind: preview.ref.kind, source: preview.badges?.[0] ?? null }),
    author: preview.title,
    dateLabel: preview.subtitle ?? null,
    quote: citationQuote(preview.body),
  };
}

function citationAccessibleName(number: number, preview: ArtifactPreview | null): string {
  const card = preview ? citationCardModel(preview) : null;
  const detail = [card?.author ?? card?.sourceLabel, card?.dateLabel].filter(Boolean).join(', ');
  return detail ? `Citation ${String(number)}, ${detail}` : `Citation ${String(number)}`;
}

function SourceMark({
  logoSrc,
  sourceKey,
  sourceLabel,
}: {
  logoSrc: string | null;
  sourceKey: string;
  sourceLabel: string;
}) {
  if (logoSrc) {
    return <ProviderLogo src={logoSrc} size="xs" title={sourceLabel} />;
  }
  const Icon = FALLBACK_ICON[sourceKey] ?? FileText;
  return (
    <span
      className="grid size-6 shrink-0 place-items-center rounded-sm border border-border bg-white p-0.5"
      title={sourceLabel}
    >
      <Icon aria-hidden="true" className="size-3.5 text-neutral-800" />
    </span>
  );
}

function SourceLink({
  action,
  className,
}: {
  action: { href: string; label: string; external?: boolean };
  className: string;
}) {
  if (action.external) {
    return (
      <a href={action.href} target="_blank" rel="noreferrer" className={className}>
        {action.label}
        <ExternalLink aria-hidden="true" className="size-3.5" />
      </a>
    );
  }
  return (
    <Link href={action.href} className={className}>
      {action.label}
      <ExternalLink aria-hidden="true" className="size-3.5" />
    </Link>
  );
}
