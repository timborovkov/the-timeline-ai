import { z } from 'zod';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MOMENT_ID_RE = /^moment:[a-z0-9:._/-]{1,180}$/i;

const contextIdsSchema = z.object({
  objectId: z.string().regex(UUID_RE).optional(),
  boardId: z.string().regex(UUID_RE).optional(),
  boardItemId: z.string().regex(UUID_RE).optional(),
  calendarEventId: z.string().regex(UUID_RE).optional(),
  documentId: z.string().regex(UUID_RE).optional(),
  taskId: z.string().regex(UUID_RE).optional(),
  meetingId: z.string().regex(UUID_RE).optional(),
  timelineEventId: z.string().regex(UUID_RE).optional(),
});

export type DashboardContextIds = z.infer<typeof contextIdsSchema>;
const dashboardContextIdKeys = Object.keys(contextIdsSchema.shape) as (keyof DashboardContextIds)[];

export const dashboardContextSchema = z.strictObject({
  ...contextIdsSchema.shape,
  pathname: z.string().trim().min(1).max(240),
  routeKind: z.string().trim().min(1).max(80),
  search: z.record(z.string().max(80), z.string().max(240)).optional(),
  calendarDate: z.string().trim().max(40).optional(),
  calendarView: z.string().trim().max(40).optional(),
  timelineMomentId: z.string().trim().min(1).max(200).optional(),
});
export type DashboardChatContext = z.infer<typeof dashboardContextSchema>;

function optionalUuid(value: unknown): string | undefined {
  return typeof value === 'string' && UUID_RE.test(value) ? value : undefined;
}

export function parseStoredDashboardContext(value: unknown): DashboardChatContext | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Record<string, unknown>;
  if (typeof raw.pathname !== 'string' || typeof raw.routeKind !== 'string') return undefined;
  const pathname = raw.pathname.trim().slice(0, 240);
  const routeKind = raw.routeKind.trim().slice(0, 80);
  if (!pathname || !routeKind) return undefined;
  const context: DashboardChatContext = { pathname, routeKind };
  if (raw.search && typeof raw.search === 'object' && !Array.isArray(raw.search)) {
    const search: Record<string, string> = {};
    for (const [key, entry] of Object.entries(raw.search as Record<string, unknown>)) {
      if (typeof entry === 'string' && key.length <= 80 && entry.length <= 240) {
        search[key] = entry;
      }
    }
    if (Object.keys(search).length > 0) context.search = search;
  }
  for (const key of dashboardContextIdKeys) {
    const id = optionalUuid(raw[key]);
    if (id) context[key] = id;
  }
  if (typeof raw.calendarDate === 'string' && raw.calendarDate.trim()) {
    context.calendarDate = raw.calendarDate.trim().slice(0, 40);
  }
  if (typeof raw.calendarView === 'string' && raw.calendarView.trim()) {
    context.calendarView = raw.calendarView.trim().slice(0, 40);
  }
  if (typeof raw.timelineMomentId === 'string' && MOMENT_ID_RE.test(raw.timelineMomentId)) {
    context.timelineMomentId = raw.timelineMomentId;
  }
  return context;
}
