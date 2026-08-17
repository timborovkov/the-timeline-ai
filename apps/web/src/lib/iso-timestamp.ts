/** Normalize RSC-serialized Date props and real Date values to an ISO string. */
export function isoTimestamp(value: Date | string | null | undefined): string | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  return typeof value === 'string' ? value : value.toISOString();
}

export function dateInputValue(value: Date | string | null | undefined): string {
  const iso = isoTimestamp(value);
  return iso ? iso.slice(0, 10) : '';
}

export function toDateOrNull(value: Date | string | null | undefined): Date | null {
  if (value === null || value === undefined || value === '') return null;
  return value instanceof Date ? value : new Date(value);
}
