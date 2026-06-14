'use client';

import Link from 'next/link';

import type { ReactNode } from 'react';

import { useInspector } from '@/components/inspector-context';
import { cn } from '@/lib/utils';

interface BaseProps {
  /** Short ID without brackets, e.g. "ev:1923", "ent:abc", "c:1923". */
  id: string;
  /**
   * Source kind, e.g. "Email", "Voice", "Object". Used for the inspector
   * head label and screen-reader text.
   */
  source?: string;
  /** Visual variant. `default` = signal-tinted; `muted` = grayscale. */
  variant?: 'default' | 'muted';
  /** Optional override for the visible chip text. Defaults to `[id]`. */
  label?: string;
  className?: string;
}

interface NavigateChipProps extends BaseProps {
  /**
   * Navigation target. Renders a `<Link>` instead of opening the
   * inspector. Used for citations that already have a canonical destination
   * and do not need a quick-view step, such as object links.
   */
  href: string;
  render?: never;
}

interface InspectorChipProps extends BaseProps {
  /**
   * Rich content for the inspector. When provided, clicking the chip
   * opens the right inspector pane instead of navigating. Used when the
   * source can be rendered inline without leaving the surface.
   */
  render: () => ReactNode;
  href?: never;
}

type CitationChipProps = NavigateChipProps | InspectorChipProps;

/**
 * The product's primary visual symbol — a monospace `[id]` chip in signal
 * color. Two modes: pass `href` to navigate, or pass `render` to open the
 * right inspector pane with rich source content. Raw event evidence uses
 * `EvidenceChip` so users get a quick-view dialog before leaving the page.
 *
 * Both modes share the same visual treatment so the chip is recognizable
 * from a thumbnail regardless of behavior.
 */
export function CitationChip(props: CitationChipProps) {
  const { id, source, variant = 'default', label, className } = props;
  const visible = label ?? `[${id}]`;
  const srLabel = source ? `Citation ${id}, source ${source}.` : `Citation ${id}.`;

  const chipClass = cn(
    'inline-flex items-center align-baseline font-mono text-[0.9em] leading-none',
    'rounded-sm px-1 py-0.5 transition-colors no-underline',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-strong focus-visible:ring-offset-1 focus-visible:ring-offset-bg',
    variant === 'default' &&
      'border border-signal/30 bg-signal-soft text-signal hover:bg-signal/25',
    variant === 'muted' && 'border border-border text-fg-muted hover:bg-surface-2',
    className,
  );

  if (isNavigate(props)) {
    return (
      <Link href={props.href} aria-label={srLabel} className={chipClass}>
        <span aria-hidden="true">{visible}</span>
      </Link>
    );
  }

  return <InspectorChip {...props} chipClass={chipClass} srLabel={srLabel} visible={visible} />;
}

function isNavigate(p: CitationChipProps): p is NavigateChipProps {
  return typeof (p as NavigateChipProps).href === 'string';
}

/**
 * Split out so `useInspector()` only runs when the chip is in inspector
 * mode — chips inside server-rendered prose (chat replay, timeline
 * notes) don't need to be inside an `<InspectorProvider>`.
 */
function InspectorChip({
  id,
  source,
  render,
  chipClass,
  srLabel,
  visible,
}: InspectorChipProps & {
  chipClass: string;
  srLabel: string;
  visible: string;
}) {
  const inspector = useInspector();
  const handle = () => {
    inspector.show({
      id,
      kind: source?.toUpperCase() ?? 'SOURCE',
      render,
    });
  };
  return (
    <button
      type="button"
      onClick={handle}
      aria-label={`${srLabel} Press Enter to view source.`}
      aria-haspopup="dialog"
      aria-expanded={inspector.open && inspector.content?.id === id}
      aria-controls="inspector-pane"
      className={chipClass}
    >
      <span aria-hidden="true">{visible}</span>
    </button>
  );
}
