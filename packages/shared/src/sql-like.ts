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

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function textMentionsAnyValue(text: string, values: readonly string[]): boolean {
  return values.some((value) =>
    new RegExp(`(^|[^a-z0-9])${escapeRegex(value)}([^a-z0-9]|$)`, 'i').test(text),
  );
}
