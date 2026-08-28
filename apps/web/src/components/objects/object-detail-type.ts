/**
 * Shared type roles for object detail (main column + Properties rail).
 * Switzer for UI copy; Commit Mono for counts, dates, and ids.
 * Keep leading dense (≤1.35 on list rows) per design.md.
 */

/** Editable / display page title (18px). */
export const OBJECT_TITLE_CLASS =
  'text-lg font-semibold leading-snug tracking-tight text-fg';

/** Sticky section titles — "Evidence · 12", "Connected work", "Discussion". */
export const OBJECT_SECTION_CLASS =
  'text-[13px] font-semibold tracking-[-0.01em] text-fg';

/** Soft subgroup under a section — "Open tasks", "Documents". */
export const OBJECT_GROUP_CLASS =
  'text-[11px] font-medium tracking-[0.01em] text-fg-muted';

/** Primary list-row title / entity link (14px medium). */
export const OBJECT_ROW_TITLE_CLASS =
  'text-sm font-medium leading-[1.35] text-fg';

/** Body copy — property values, note text, prose blocks. */
export const OBJECT_BODY_CLASS =
  'text-sm font-normal leading-[1.45] text-fg';

/** Secondary line under a row (source, status, relationship). */
export const OBJECT_ROW_META_CLASS =
  'text-xs font-normal leading-snug text-fg-dim';

/** Counts, timestamps, ids — Commit Mono + tabular nums. */
export const OBJECT_MONO_META_CLASS =
  'font-mono text-[11px] font-normal tabular-nums tracking-tight text-fg-dim';

/** Quiet empty / add prompts. */
export const OBJECT_QUIET_CLASS =
  'text-xs font-normal text-fg-faint';

/** Fold / secondary text controls ("Show 5 more", "View", "Edit"). */
export const OBJECT_CONTROL_CLASS =
  'text-xs font-medium text-fg-muted transition-colors hover:text-fg';

/** Rail property label (Status, Priority, …). */
export const OBJECT_RAIL_LABEL_CLASS =
  'w-[6.75rem] shrink-0 text-xs font-medium leading-4 text-fg-dim';

/** Rail value / link text. */
export const OBJECT_RAIL_VALUE_CLASS =
  'text-sm font-normal leading-5 text-fg';
