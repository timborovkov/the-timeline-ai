import type {
  GlobalSearchKind,
  GlobalSearchMode,
  GlobalSearchResponse,
} from '@timeline/shared/search';

import { readJson } from '@/lib/paginated-api';

export interface GlobalSearchRequest {
  query: string;
  mode: GlobalSearchMode;
  kinds?: GlobalSearchKind[];
  source?: string | null;
  from?: string | null;
  to?: string | null;
  limit?: number;
  signal?: AbortSignal;
}

function toIsoStartOfNextDayForDateOnly(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return new Date(value).toISOString();

  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day) + 1));
  return date.toISOString();
}

export async function fetchGlobalSearch(input: GlobalSearchRequest): Promise<GlobalSearchResponse> {
  const body: Record<string, unknown> = {
    query: input.query,
    mode: input.mode,
  };
  if (input.kinds && input.kinds.length > 0) body.kinds = input.kinds;
  if (input.source) body.source = input.source;
  if (input.from) body.from = new Date(input.from).toISOString();
  if (input.to) body.to = toIsoStartOfNextDayForDateOnly(input.to);
  if (input.limit) body.limit = input.limit;

  return readJson<GlobalSearchResponse>(
    await fetch('/api/search/global', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: input.signal,
    }),
  );
}
