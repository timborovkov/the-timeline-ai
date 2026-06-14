export interface ObjectSearchResult {
  id: string;
  canonicalName: string;
  type: string;
}

export interface ObjectSearchResponse {
  query: string;
  results?: ObjectSearchResult[];
}

function isObjectSearchResult(value: unknown): value is ObjectSearchResult {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.id === 'string' &&
    typeof row.canonicalName === 'string' &&
    typeof row.type === 'string'
  );
}

function objectSearchResultMatchesQuery(result: ObjectSearchResult, query: string): boolean {
  return result.canonicalName.toLowerCase().includes(query.toLowerCase());
}

export function visibleObjectSearchResultsForQuery(
  data: ObjectSearchResponse | undefined,
  query: string,
): ObjectSearchResult[] {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const results = data?.results?.filter(isObjectSearchResult) ?? [];
  if (data?.query === trimmed) return results;
  return results.filter((result) => objectSearchResultMatchesQuery(result, trimmed));
}
