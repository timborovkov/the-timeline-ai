/** PostgreSQL and the migration-test adapter return different execute envelopes. */
export function lifecycleRows(result: unknown): Record<string, unknown>[] {
  if (Array.isArray(result)) return result as Record<string, unknown>[];
  if (result && typeof result === 'object' && 'rows' in result && Array.isArray(result.rows))
    return result.rows as Record<string, unknown>[];
  throw new Error('Unsupported lifecycle query result');
}
