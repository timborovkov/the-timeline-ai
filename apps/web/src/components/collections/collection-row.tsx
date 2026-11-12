import { Children, isValidElement, type MouseEventHandler, type ReactNode } from 'react';

import {
  createCollectionSlot,
  readCollectionSlots,
} from '@/components/collections/collection-slot';
import { cn } from '@/lib/utils';

const CollectionRowLeading = createCollectionSlot('leading');
const CollectionRowTitle = createCollectionSlot('title');
const CollectionRowSubtitle = createCollectionSlot('subtitle');
const CollectionRowContext = createCollectionSlot('context');
const CollectionRowMetadata = createCollectionSlot('metadata');
const CollectionRowActions = createCollectionSlot('actions');

const ROW_SLOTS = {
  leading: CollectionRowLeading,
  title: CollectionRowTitle,
  subtitle: CollectionRowSubtitle,
  context: CollectionRowContext,
  metadata: CollectionRowMetadata,
  actions: CollectionRowActions,
};

const SLOT_LAYER =
  'relative z-10 pointer-events-none [&_a]:pointer-events-auto [&_button]:pointer-events-auto [&_input]:pointer-events-auto [&_label]:pointer-events-auto [&_select]:pointer-events-auto [&_textarea]:pointer-events-auto';

type CollectionRowProps = {
  children?: ReactNode;
  selected?: boolean;
  className?: string;
  onNavigate?: MouseEventHandler<HTMLAnchorElement>;
} & (
  | {
      onActivate: () => void;
      activateLabel: string;
      href?: never;
    }
  | {
      href: string;
      activateLabel: string;
      onActivate?: never;
    }
  | {
      onActivate?: undefined;
      activateLabel?: undefined;
      href?: never;
    }
);

function readRowHints(children: ReactNode): { titleHint?: string; contextTitle?: string } {
  let titleHint: string | undefined;
  let contextTitle: string | undefined;
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return;
    const hint = (child.props as { title?: string }).title;
    if (child.type === CollectionRowTitle) titleHint = hint;
    if (child.type === CollectionRowContext) contextTitle = hint;
  });
  return { titleHint, contextTitle };
}

export function CollectionRow({
  children,
  selected = false,
  onActivate,
  activateLabel,
  href,
  className,
  onNavigate,
}: CollectionRowProps) {
  const slots = readCollectionSlots(children, ROW_SLOTS);
  const { titleHint, contextTitle } = readRowHints(children);
  const leading = slots.leading;
  const title = slots.title;
  const subtitle = slots.subtitle;
  const context = slots.context;
  const metadata = slots.metadata;
  const actions = slots.actions;

  return (
    <div
      data-slot="collection-row"
      className={cn(
        'group/collection-row @container/collection-row relative grid min-h-11 min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 border-b border-border/80 px-2 transition-[background-color,border-color] duration-150 hover:bg-surface focus-within:bg-surface motion-reduce:transition-none sm:px-3',
        selected && 'bg-signal-soft shadow-[inset_2px_0_0_var(--color-signal)]',
        Boolean(onActivate ?? href) && 'cursor-pointer',
        className,
      )}
    >
      {href ? (
        <a
          href={href}
          onClick={onNavigate}
          aria-label={activateLabel}
          className="absolute inset-0 z-0 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/50"
        />
      ) : onActivate ? (
        <button
          type="button"
          aria-label={activateLabel}
          className="absolute inset-0 z-0 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/50"
          onClick={onActivate}
        />
      ) : null}
      <div className={cn(SLOT_LAYER, 'flex min-h-10 shrink-0 items-center self-start')}>
        {leading}
      </div>
      <div
        data-slot="collection-row-content"
        className={cn(SLOT_LAYER, 'flex min-w-0 flex-col items-start gap-1 py-3')}
      >
        <div data-slot="collection-row-heading" className="w-full min-w-0">
          <div
            data-slot="collection-row-title"
            className="min-w-0 whitespace-normal text-sm font-medium leading-5 text-fg [overflow-wrap:anywhere]"
            title={titleHint}
          >
            {title}
          </div>
          {subtitle ? (
            <div
              data-slot="collection-row-subtitle"
              className="min-w-0 whitespace-normal text-xs font-normal leading-5 text-fg-muted [overflow-wrap:anywhere]"
            >
              {subtitle}
            </div>
          ) : null}
        </div>
        {context || metadata ? (
          <div className="flex w-full min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
            {context ? (
              <div
                data-slot="collection-row-context"
                className="min-w-0 text-xs leading-5 text-fg-muted [overflow-wrap:anywhere]"
                title={contextTitle}
              >
                {context}
              </div>
            ) : null}
            {metadata ? (
              <div className="flex min-w-0 max-w-full flex-wrap items-center gap-x-2 gap-y-1">
                {metadata}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
      {actions ? (
        <div className={cn(SLOT_LAYER, 'flex min-h-10 min-w-0 items-center self-start pt-1')}>
          {actions}
        </div>
      ) : null}
    </div>
  );
}

CollectionRow.Leading = CollectionRowLeading;
CollectionRow.Title = CollectionRowTitle;
CollectionRow.Subtitle = CollectionRowSubtitle;
CollectionRow.Context = CollectionRowContext;
CollectionRow.Metadata = CollectionRowMetadata;
CollectionRow.Actions = CollectionRowActions;
