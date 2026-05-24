import { objects, withTeam } from '@timeline/shared';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { z } from 'zod';

import { DeleteBoardButton } from '@/components/boards/delete-board-button';
import { KanbanBoard } from '@/components/boards/kanban-board';
import { ObjectList } from '@/components/boards/object-list';
import { ObjectTable } from '@/components/boards/object-table';
import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';

type GroupKey = 'status' | 'stage' | 'priority' | 'type';

const VALID_GROUP_KEYS: readonly GroupKey[] = ['status', 'stage', 'priority', 'type'];

function isGroupKey(v: string | null | undefined): v is GroupKey {
  return v !== null && v !== undefined && (VALID_GROUP_KEYS as readonly string[]).includes(v);
}

// `board.filter` is raw JSONB from `board_views` — every field needs to
// survive a stale schema or a UI bug that wrote junk. Run the whole
// payload through a tolerant zod schema (each field validated
// independently with `.catch(undefined)`) so a bad `limit` / `archived` /
// `dueAt` doesn't bubble up as a SQL error with no UI recovery path. The
// `type` field is also narrowed against the live enum so a removed value
// doesn't throw at the planner.
const stringOrArray = z.union([z.string(), z.array(z.string())]);
const dateLike = z
  .union([z.string(), z.date()])
  .transform((v) => (v instanceof Date ? v : new Date(v)))
  .refine((d) => !Number.isNaN(d.getTime()));
// Every field is `.optional()` already; no `.partial()` wrapper — that
// would double-wrap each field in a second ZodOptional, which is
// functionally harmless but misleading at the schema-reading site.
const boardFilterSchema = z.object({
  type: z.union([z.enum(objects.OBJECT_TYPES), z.array(z.enum(objects.OBJECT_TYPES))]).optional(),
  status: stringOrArray.optional(),
  stage: stringOrArray.optional(),
  ownerUserId: z.union([z.string(), z.null()]).optional(),
  assigneeUserId: z.union([z.string(), z.null()]).optional(),
  dueBefore: dateLike.optional(),
  dueAfter: dateLike.optional(),
  archived: z.boolean().optional(),
  limit: z.number().int().min(1).max(500).optional(),
  offset: z.number().int().min(0).optional(),
});

function sanitizeBoardFilter(filter: Record<string, unknown>): objects.ObjectListFilter {
  // Validate field-by-field. A single bad field shouldn't nuke the whole
  // filter — keep the rest and drop the invalid one.
  const shape = boardFilterSchema.shape as Record<string, z.ZodTypeAny>;
  const out: objects.ObjectListFilter = {};
  for (const [key, value] of Object.entries(filter)) {
    if (value === undefined) continue;
    const fieldSchema = shape[key];
    if (!fieldSchema) continue;
    const result = fieldSchema.safeParse(value);
    if (result.success) (out as Record<string, unknown>)[key] = result.data;
  }
  return out;
}

export default async function BoardDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) redirect('/sign-in');
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) redirect('/sign-in');

  const scope = withTeam(db, active.teamId, session.user.id);
  const { id } = await params;
  const board = await objects.getBoardView(db, scope, id);
  if (!board) notFound();

  const sanitizedFilter = sanitizeBoardFilter(board.filter);
  const rows = await objects.listObjects(db, scope, sanitizedFilter);

  const groupBy: GroupKey = isGroupKey(board.groupBy) ? board.groupBy : 'status';
  // KanbanBoard's groupBy is narrower (no 'type'). Collapse 'type' to
  // 'status' for the kanban kind, and use the collapsed value in BOTH
  // the header label and the prop so the UI claim matches what's shown.
  const effectiveGroupBy: GroupKey =
    board.kind === 'kanban' && groupBy === 'type' ? 'status' : groupBy;

  // Kanban needs a known parent height to enable per-column scroll —
  // tasks page does the same trick. Table/list size to content and are
  // fine in the default main flow.
  const isKanban = board.kind === 'kanban';

  return (
    <div className={isKanban ? 'flex h-[calc(100dvh-11rem)] flex-col' : undefined}>
      <header className="mb-8 flex shrink-0 items-end justify-between gap-6">
        <div>
          <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
            <Link href="/app/boards" className="hover:underline">
              Boards
            </Link>{' '}
            · {board.kind}
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">{board.name}</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {rows.length} object{rows.length === 1 ? '' : 's'}
            {board.kind !== 'table' && ` · grouped by ${effectiveGroupBy}`}
          </p>
        </div>
        <DeleteBoardButton id={board.id} />
      </header>

      {isKanban && (
        <div className="min-h-0 flex-1">
          {/* `effectiveGroupBy` is collapsed to KanbanBoard's narrower union
              above when this branch runs (board.kind === 'kanban'); the cast
              tells TS what the runtime guarantee is. */}
          <KanbanBoard rows={rows} groupBy={effectiveGroupBy as 'status' | 'stage' | 'priority'} />
        </div>
      )}
      {board.kind === 'table' && <ObjectTable rows={rows} />}
      {board.kind === 'list' && <ObjectList rows={rows} groupBy={effectiveGroupBy} />}
    </div>
  );
}
