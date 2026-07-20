import { type SQL, type SQLWrapper, sql } from 'drizzle-orm';

import type { DueDateRangeFilter } from '#src/time/index.js';

import { assertValidTimezone } from '#src/time/index.js';

const LOCAL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function dueDateExpression(column: SQLWrapper, timezone: string): SQL {
  const safeTimezone = assertValidTimezone(timezone);
  return sql`CASE
    WHEN (${column} AT TIME ZONE 'UTC')::time = TIME '00:00:00'
      THEN (${column} AT TIME ZONE 'UTC')::date
    ELSE (${column} AT TIME ZONE ${safeTimezone})::date
  END`;
}

export function dueDateRangeConditions(
  column: SQLWrapper,
  range: DueDateRangeFilter | undefined,
): SQL[] {
  if (!range) return [];
  const expression = dueDateExpression(column, range.timezone);
  const conditions: SQL[] = [];
  if (range.from) {
    conditions.push(
      LOCAL_DATE_PATTERN.test(range.from) ? sql`${expression} >= ${range.from}::date` : sql`false`,
    );
  }
  if (range.to) {
    conditions.push(
      LOCAL_DATE_PATTERN.test(range.to) ? sql`${expression} < ${range.to}::date` : sql`false`,
    );
  }
  return conditions;
}
