import { dateOnlyEventRange } from '@timeline/shared/time';
import { z } from 'zod';

export const searchDateOnly = z.iso.date().refine((value) => !value.startsWith('0000-'));
export const searchDateBound = z.union([searchDateOnly, z.iso.datetime()]);

export function searchDateErrors(from: string, to: string): { from?: string; to?: string } {
  const errors: { from?: string; to?: string } = {};
  if (from && !searchDateOnly.safeParse(from).success) errors.from = 'Enter a valid start date.';
  if (to && !searchDateOnly.safeParse(to).success) errors.to = 'Enter a valid end date.';
  if (!errors.from && !errors.to && from && to && from > to) {
    errors.to = 'End date must be on or after the start date.';
  }
  return errors;
}

export function resolveSearchDateBound(
  value: string | undefined,
  edge: 'from' | 'to',
  timezone: string,
): Date | undefined {
  if (!value) return;
  if (!searchDateOnly.safeParse(value).success) return new Date(value);
  const range = dateOnlyEventRange(value, timezone);
  return edge === 'from' ? range.startAt : range.endAt;
}
