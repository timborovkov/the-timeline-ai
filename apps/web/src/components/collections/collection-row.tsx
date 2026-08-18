import { Children, isValidElement, type ReactNode } from 'react';

import {
  createCollectionSlot,
  readCollectionSlots,
} from '@/components/collections/collection-slot';
import { cn } from '@/lib/utils';

const CollectionRowLeading = createCollectionSlot('leading');
const CollectionRowTitle = createCollectionSlot('title');
const CollectionRowContext = createCollectionSlot('context');
const CollectionRowMetadata = createCollectionSlot('metadata');
const CollectionRowActions = createCollectionSlot('actions');

const ROW_SLOTS = {
  leading: CollectionRowLeading,
  title: CollectionRowTitle,
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
} & (
  | {
      onActivate: () => void;
      activateLabel: string;
    }
  | {
      onActivate?: undefined;
      activateLabel?: undefined;
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
  className,
}: CollectionRowProps) {
  const slots = readCollectionSlots(children, ROW_SLOTS);
  const { titleHint, contextTitle } = readRowHints(children);
  const leading = slots.leading;
  const title = slots.title;
  const context = slots.context;
  const metadata = slots.metadata;
  const actions = slots.actions;

  return (
    <div
      className={cn(
        'group/collection-row relative grid min-h-11 min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 border-b border-border/80 px-2 transition-[background-color,border-color] duration-150 hover:bg-surface focus-within:bg-surface motion-reduce:transition-none sm:px-3',
        selected && 'bg-signal-soft shadow-[inset_2px_0_0_var(--color-signal)]',
        onActivate && 'cursor-pointer',
        className,
      )}
    >
      {onActivate ? (
        <button
          type="button"
          aria-label={activateLabel}
          className="absolute inset-0 z-0 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/50"
          onClick={onActivate}
        />
      ) : null}
      <div className={cn(SLOT_LAYER, 'flex min-h-10 shrink-0 items-center')}>{leading}</div>
      <div
        className={cn(
          SLOT_LAYER,
          'flex min-w-0 flex-col justify-center py-1 sm:flex-row sm:items-center sm:gap-3',
        )}
      >
        <div className="min-w-0 flex-1">
          <div className="min-w-0 truncate text-sm font-medium leading-5 text-fg" title={titleHint}>
            {title}
          </div>
          {context ? (
            <div
              className="min-w-0 truncate text-[11px] leading-4 text-fg-dim sm:hidden"
              title={contextTitle}
            >
              {context}
            </div>
          ) : null}
        </div>
        {context ? (
          <div
            className="hidden min-w-0 max-w-[22rem] truncate text-xs text-fg-dim sm:block"
            title={contextTitle}
          >
            {context}
          </div>
        ) : null}
        {metadata ? (
          <div className="flex min-w-0 flex-wrap items-center gap-x-1 gap-y-0.5 sm:ml-auto sm:flex-nowrap sm:justify-end">
            {metadata}
          </div>
        ) : null}
      </div>
      <div className={cn(SLOT_LAYER, 'flex min-h-10 shrink-0 items-center')}>{actions}</div>
    </div>
  );
}

CollectionRow.Leading = CollectionRowLeading;
CollectionRow.Title = CollectionRowTitle;
CollectionRow.Context = CollectionRowContext;
CollectionRow.Metadata = CollectionRowMetadata;
CollectionRow.Actions = CollectionRowActions;
