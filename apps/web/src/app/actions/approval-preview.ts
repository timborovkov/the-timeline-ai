'use server';

import { displayObjectTitle } from '@timeline/shared/objects/types';
import { z } from 'zod';

import type {
  ApprovalCalendarSnapshot,
  ApprovalObjectSnapshot,
  ApprovalTargetSnapshot,
} from '@/lib/approval-preview';

import { type ActionState, resolveScope, uuidSchema } from '@/lib/action-scope';
import { displayMemberLabel } from '@/lib/display-labels';
import { publicActionError } from '@/lib/public-error';
import { runSentryServerAction } from '@/lib/sentry-action';

export interface ApprovalPreviewActionState extends ActionState {
  snapshot?: ApprovalTargetSnapshot;
  members?: Record<string, string>;
}

function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  return value;
}

function serializeObject(row: {
  id: string;
  type: string;
  canonicalName: string;
  metadata: Record<string, unknown>;
  status: string;
  stage: string | null;
  priority: number | null;
  ownerUserId: string | null;
  assigneeUserId: string | null;
  dueAt: Date | string | null;
  aliases: string[];
  createdAt: Date | string;
  updatedAt: Date | string;
  archivedAt: Date | string | null;
  notes?: { body: string }[];
}): ApprovalObjectSnapshot {
  const note = row.notes?.[0]?.body.trim();
  return {
    id: row.id,
    type: row.type,
    title: displayObjectTitle(row),
    status: row.status,
    stage: row.stage,
    priority: row.priority,
    ownerUserId: row.ownerUserId,
    assigneeUserId: row.assigneeUserId,
    dueAt: iso(row.dueAt),
    aliases: row.aliases,
    content: note ?? null,
    createdAt: iso(row.createdAt) ?? '',
    updatedAt: iso(row.updatedAt) ?? '',
    archivedAt: iso(row.archivedAt),
  };
}

function serializeCalendar(row: {
  id: string;
  title: string;
  description: string | null;
  startAt: Date | string;
  endAt: Date | string;
  timezone: string;
  allDay: boolean;
  location: string | null;
  showAs: string;
  rrule: string | null;
  visibility: string;
  createdAt: Date | string;
  updatedAt: Date | string;
}): ApprovalCalendarSnapshot {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    startAt: iso(row.startAt) ?? '',
    endAt: iso(row.endAt) ?? '',
    timezone: row.timezone,
    allDay: row.allDay,
    location: row.location,
    showAs: row.showAs,
    rrule: row.rrule,
    visibility: row.visibility,
    createdAt: iso(row.createdAt) ?? '',
    updatedAt: iso(row.updatedAt) ?? '',
  };
}

export async function getApprovalTargetSnapshotAction(
  input: unknown,
): Promise<ApprovalPreviewActionState> {
  return runSentryServerAction('get_approval_target_snapshot', async () => {
    const parsed = z
      .object({
        targetKind: z.string().min(1),
        targetId: uuidSchema.nullable().optional(),
        objectIds: z.array(uuidSchema).max(20).optional(),
      })
      .safeParse(input);
    if (!parsed.success) return { error: 'Invalid preview target' };
    const resolved = await resolveScope();
    if (!resolved.ok) return { error: resolved.error };

    const members = await resolved.scope.timeline.listMembers();
    const memberLabels: Record<string, string> = {};
    for (const member of members) {
      memberLabels[member.userId] = displayMemberLabel({
        name: member.name,
        email: member.email,
      });
    }

    try {
      if (parsed.data.targetKind === 'calendar_event' && parsed.data.targetId) {
        const event = await resolved.scope.calendar.getCalendarEvent(parsed.data.targetId);
        if (!event || event.redacted) return { snapshot: { kind: 'none' }, members: memberLabels };
        return {
          ok: true,
          snapshot: { kind: 'calendar_event', event: serializeCalendar(event) },
          members: memberLabels,
        };
      }

      if (parsed.data.targetKind === 'object_merge') {
        const ids = parsed.data.objectIds ?? [];
        const objects = await Promise.all(ids.map((id) => resolved.scope.objects.getObject(id)));
        return {
          ok: true,
          snapshot: {
            kind: 'merge',
            objects: objects.filter((row) => row !== null).map((row) => serializeObject(row)),
          },
          members: memberLabels,
        };
      }

      if (
        parsed.data.targetId &&
        (parsed.data.targetKind === 'object' ||
          parsed.data.targetKind === 'task' ||
          parsed.data.targetKind === 'object_note' ||
          parsed.data.targetKind === 'board_item_update' ||
          parsed.data.targetKind === 'board_membership' ||
          parsed.data.targetKind === 'identity_facet')
      ) {
        const object = await resolved.scope.objects.getObject(parsed.data.targetId);
        if (!object) return { snapshot: { kind: 'none' }, members: memberLabels };
        return {
          ok: true,
          snapshot: { kind: 'object', object: serializeObject(object) },
          members: memberLabels,
        };
      }

      return { ok: true, snapshot: { kind: 'none' }, members: memberLabels };
    } catch (err) {
      return {
        error: publicActionError(err, {
          operation: 'get_approval_target_snapshot',
          fallback: 'Unable to load the current record.',
        }),
      };
    }
  });
}
