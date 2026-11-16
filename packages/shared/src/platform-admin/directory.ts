import { asc, desc, gte, lte, type AnyColumn, type SQL } from 'drizzle-orm';

export interface DirectoryOptions {
  page?: string;
  team?: string;
  status?: string;
  sort?: string;
  direction?: string;
  from?: string;
  to?: string;
  plan?: string;
  actor?: string;
  role?: string;
}
export function directoryOrder(
  options: DirectoryOptions,
  columns: Record<string, AnyColumn | SQL>,
  fallback: AnyColumn | SQL,
) {
  const column = columns[options.sort ?? ''] ?? fallback;
  return options.direction === 'asc' ? asc(column) : desc(column);
}
export function directoryDates(column: AnyColumn, options: DirectoryOptions) {
  const validDate = (value: string | undefined, end: boolean) => {
    if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
    const date = new Date(`${value}T${end ? '23:59:59.999' : '00:00:00.000'}Z`);
    return Number.isFinite(date.getTime()) ? date : undefined;
  };
  const from = validDate(options.from, false),
    to = validDate(options.to, true);
  return [from ? gte(column, from) : undefined, to ? lte(column, to) : undefined];
}
