import type * as boards from '@timeline/shared/boards';
import type * as objects from '@timeline/shared/objects';

export type WorkQueueReason =
  | 'pending_approval'
  | 'responsible_to_you'
  | 'team_due'
  | 'overdue'
  | 'due_soon'
  | 'blocked'
  | 'owned_by_you'
  | 'assigned_to_you';

export interface WorkQueueItem {
  id: string;
  entityId?: string;
  href: string;
  title: string;
  subtitle: string;
  source: 'approval' | 'board' | 'object';
  sourceLabel: string;
  objectType?: string;
  dueAt: Date | null;
  priority: number | null;
  updatedAt: Date;
  reasons: WorkQueueReason[];
}

const DONE_STATUSES = new Set(['done', 'cancelled', 'canceled', 'shipped']);

function isOpenWorkObject(row: objects.ObjectRow): boolean {
  return !row.archivedAt && !DONE_STATUSES.has(row.status.toLowerCase());
}

export function reasonLabel(reason: WorkQueueReason): string {
  switch (reason) {
    case 'pending_approval':
      return 'Pending approval';
    case 'responsible_to_you':
      return 'Responsible to you';
    case 'team_due':
      return 'Team due';
    case 'overdue':
      return 'Overdue';
    case 'due_soon':
      return 'Due soon';
    case 'blocked':
      return 'Blocked';
    case 'owned_by_you':
      return 'Owned by you';
    case 'assigned_to_you':
      return 'Assigned to you';
  }
}

export function reasonTone(reason: WorkQueueReason): 'danger' | 'signal' | 'neutral' {
  if (reason === 'overdue' || reason === 'pending_approval') return 'danger';
  if (
    reason === 'due_soon' ||
    reason === 'responsible_to_you' ||
    reason === 'team_due' ||
    reason === 'blocked'
  ) {
    return 'signal';
  }
  return 'neutral';
}

function dueReasons(dueAt: Date | null, now: Date, dueSoon: Date): WorkQueueReason[] {
  if (!dueAt) return [];
  if (dueAt < now) return ['overdue'];
  if (dueAt <= dueSoon) return ['due_soon'];
  return [];
}

function blockedReason(status: string, laneKind?: boards.BoardLaneKind | null): WorkQueueReason[] {
  if (status.toLowerCase() === 'blocked' || laneKind === 'blocked') return ['blocked'];
  return [];
}

function uniqueReasons(reasons: WorkQueueReason[]): WorkQueueReason[] {
  return Array.from(new Set(reasons));
}

export function approvalQueueItem(count: number, now: Date): WorkQueueItem | null {
  if (count <= 0) return null;
  return {
    id: 'approvals',
    href: '/app/approvals',
    title: `${count} pending ${count === 1 ? 'approval' : 'approvals'}`,
    subtitle: 'Agent proposals waiting for review',
    source: 'approval',
    sourceLabel: 'Approvals',
    dueAt: null,
    priority: null,
    updatedAt: now,
    reasons: ['pending_approval'],
  };
}

export function boardQueueItem(
  row: boards.BoardWorkQueueItemRow,
  userId: string,
  now: Date,
  dueSoon: Date,
): WorkQueueItem {
  return {
    id: `board:${row.id}`,
    entityId: row.entityId,
    href: `/app/boards/${row.boardId}?item=${row.id}`,
    title: row.object.canonicalName,
    subtitle: [row.boardName, row.laneName].filter(Boolean).join(' · '),
    source: 'board',
    sourceLabel: 'Board item',
    objectType: row.object.type,
    dueAt: row.dueAt,
    priority: row.priority,
    updatedAt: row.updatedAt,
    reasons: uniqueReasons([
      ...(row.responsibleUserId === userId ? (['responsible_to_you'] as const) : []),
      ...(row.dueAt && !row.responsibleUserId ? (['team_due'] as const) : []),
      ...dueReasons(row.dueAt, now, dueSoon),
      ...blockedReason(row.object.status, row.laneKind),
    ]),
  };
}

export function objectQueueItem(
  row: objects.ObjectRow,
  userId: string,
  now: Date,
  dueSoon: Date,
): WorkQueueItem | null {
  if (!isOpenWorkObject(row)) return null;
  const reasons = uniqueReasons([
    ...(row.ownerUserId === userId ? (['owned_by_you'] as const) : []),
    ...(row.assigneeUserId === userId ? (['assigned_to_you'] as const) : []),
    ...(row.dueAt && !row.ownerUserId && !row.assigneeUserId ? (['team_due'] as const) : []),
    ...dueReasons(row.dueAt, now, dueSoon),
    ...blockedReason(row.status),
  ]);
  if (reasons.length === 0) return null;
  return {
    id: `object:${row.id}`,
    entityId: row.id,
    href: row.type === 'task' ? '/app/tasks' : `/app/objects/${row.id}`,
    title: row.canonicalName,
    subtitle: `${row.type.replace('_', ' ')} · ${row.status}`,
    source: 'object',
    sourceLabel: row.type === 'task' ? 'Task' : 'Object',
    objectType: row.type,
    dueAt: row.dueAt,
    priority: row.priority,
    updatedAt: row.updatedAt,
    reasons,
  };
}

function reasonRank(item: WorkQueueItem): number {
  if (item.reasons.includes('pending_approval')) return 0;
  if (item.reasons.includes('overdue')) return 1;
  if (item.reasons.includes('due_soon')) return 2;
  if (
    item.reasons.includes('responsible_to_you') ||
    item.reasons.includes('owned_by_you') ||
    item.reasons.includes('assigned_to_you')
  ) {
    return 3;
  }
  return 4;
}

export function sortWorkQueueItems(items: WorkQueueItem[]): WorkQueueItem[] {
  return Array.from(items).sort((a, b) => {
    const rank = reasonRank(a) - reasonRank(b);
    if (rank !== 0) return rank;
    const aDue = a.dueAt?.getTime() ?? Number.POSITIVE_INFINITY;
    const bDue = b.dueAt?.getTime() ?? Number.POSITIVE_INFINITY;
    if (aDue !== bDue) return aDue - bDue;
    return b.updatedAt.getTime() - a.updatedAt.getTime();
  });
}

function queueEntityKey(item: WorkQueueItem): string {
  if (item.source === 'approval') return item.id;
  return item.entityId ? `entity:${item.entityId}` : item.id;
}

export function dedupeWorkQueueItems(items: WorkQueueItem[]): WorkQueueItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = queueEntityKey(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
