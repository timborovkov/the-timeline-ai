import { or, sql, type SQL } from 'drizzle-orm';

export function likePattern(value: string): string {
  return `%${value.replace(/[\\%_]/g, (match) => `\\${match}`)}%`;
}

export function likeMentionCondition(column: unknown, values: readonly string[]): SQL | undefined {
  const conditions = values.map(
    (value) => sql`lower(${column as never}) LIKE ${likePattern(value.toLowerCase())} ESCAPE '\\'`,
  );
  return conditions.length > 0 ? or(...conditions) : undefined;
}
