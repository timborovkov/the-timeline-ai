export const TASK_STATUS_COLUMNS = [
  'backlog',
  'open',
  'doing',
  'blocked',
  'done',
  'cancelled',
] as const;

const TASK_STATUS_DISPLAY_ALIASES = {
  backlog: ['backlog', 'suggested', 'proposed'],
  open: ['open', 'todo'],
  doing: ['doing'],
  blocked: ['blocked'],
  done: ['done'],
  cancelled: ['cancelled'],
} satisfies Record<(typeof TASK_STATUS_COLUMNS)[number], readonly string[]>;

const TASK_STATUS_FILTER_ALIASES: Readonly<Record<string, readonly string[] | undefined>> = {
  ...TASK_STATUS_DISPLAY_ALIASES,
  cancelled: ['cancelled', 'canceled'],
};

const DISPLAY_STATUS_BY_ALIAS = new Map<string, string>(
  Object.entries(TASK_STATUS_DISPLAY_ALIASES).flatMap(([status, aliases]) =>
    aliases.map((alias) => [alias, status] as const),
  ),
);

/** Collapse source-specific and legacy task states into the board's user-facing workflow. */
export function taskDisplayStatus(status: string): string {
  return DISPLAY_STATUS_BY_ALIAS.get(status.trim().toLowerCase()) ?? status;
}

/** Expand a user-facing task filter so it continues to match legacy and imported rows. */
export function taskStatusFilterValues(statuses: readonly string[]): string[] {
  const values = new Set<string>();
  for (const status of statuses) {
    const normalized = status.trim().toLowerCase();
    const aliases = TASK_STATUS_FILTER_ALIASES[normalized];
    for (const value of aliases ?? [status]) values.add(value);
  }
  return [...values];
}
