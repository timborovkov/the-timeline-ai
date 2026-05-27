export interface TimeIdCursor {
  at: string;
  id: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function encodeCursor(cursor: TimeIdCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

export function decodeCursor(input: string | undefined | null): TimeIdCursor | null {
  if (!input) return null;
  try {
    const raw = JSON.parse(Buffer.from(input, 'base64url').toString('utf8')) as unknown;
    if (!raw || typeof raw !== 'object') return null;
    const at = (raw as { at?: unknown }).at;
    const id = (raw as { id?: unknown }).id;
    if (typeof at !== 'string' || typeof id !== 'string') return null;
    const d = new Date(at);
    if (Number.isNaN(d.getTime()) || !UUID_RE.test(id)) return null;
    return { at: d.toISOString(), id };
  } catch {
    return null;
  }
}

export function pageWindow<T>(
  rows: T[],
  pageSize: number,
  cursorFor: (row: T) => TimeIdCursor,
): { items: T[]; nextCursor: string | null } {
  const items = rows.slice(0, pageSize);
  const last = items.at(-1);
  return {
    items,
    nextCursor: rows.length > pageSize && last ? encodeCursor(cursorFor(last)) : null,
  };
}
