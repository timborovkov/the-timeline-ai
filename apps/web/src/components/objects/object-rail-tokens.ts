import {
  OBJECT_CONTROL_CLASS,
  OBJECT_RAIL_LABEL_CLASS,
  OBJECT_RAIL_VALUE_CLASS,
  OBJECT_SECTION_CLASS,
} from '@/components/objects/object-detail-type';
import { cn } from '@/lib/utils';

/** Shared object/task Properties rail field chrome (design.md Linear density). */
export const RAIL_FIELD_VALUE = cn(
  OBJECT_RAIL_VALUE_CLASS,
  'min-w-0 flex-1 bg-transparent outline-none placeholder:text-fg-dim focus-visible:ring-2 focus-visible:ring-signal/50',
);
export const RAIL_QUIET_ACTION = cn(
  OBJECT_CONTROL_CLASS,
  'inline-flex min-h-8 items-center gap-1.5 px-2 disabled:opacity-50',
);
export const RAIL_UNDERLINE_CONTROL = cn(
  OBJECT_RAIL_VALUE_CLASS,
  'h-8 w-full border-0 border-b border-border bg-transparent px-0 outline-none placeholder:text-fg-dim focus-visible:border-signal',
);
export const RAIL_GHOST_ICON_BUTTON = cn(
  'grid size-7 shrink-0 place-items-center rounded-sm text-fg-muted transition-colors',
  'opacity-0 focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100',
  'hover:bg-danger/10 hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/50 disabled:opacity-50',
);

export const RAIL_SECTION_LABEL = cn(OBJECT_SECTION_CLASS, 'px-2');
export const RAIL_FIELD_LABEL = OBJECT_RAIL_LABEL_CLASS;
export const RAIL_ROW = 'group flex min-h-8 items-center gap-2 px-2';
