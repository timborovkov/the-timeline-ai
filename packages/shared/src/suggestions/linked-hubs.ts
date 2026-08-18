import { calendarEventEntities, entities, meetings, type Db } from '@timeline/db';
import { and, eq, inArray, isNull } from 'drizzle-orm';

import {
  uniqueAccountHub,
  uniqueHubOfType,
  WORKSPACE_HUB_TYPES,
  type QualifiedWorkspaceHubs,
  type WorkspaceHub,
} from '#src/suggestions/hub-context.js';

/**
 * When mention/container qualify is silent, inherit a unique company/project
 * from calendar / Saved Meeting object links. Two hubs of the same type still
 * refuse. Does not rewrite already-qualified unique hubs.
 */
export function mergeInheritedLinkedHubs(args: {
  qualified: QualifiedWorkspaceHubs;
  linked: readonly WorkspaceHub[];
}): QualifiedWorkspaceHubs {
  const linkedHubs = args.linked.filter((hub) => hub.status !== 'archived');
  const uniqueProject = args.qualified.uniqueProject ?? uniqueHubOfType(linkedHubs, 'project');
  const uniqueCompany = args.qualified.uniqueCompany ?? uniqueAccountHub(linkedHubs);
  const mentioned = [...args.qualified.mentioned];
  const seen = new Set(mentioned.map((hub) => hub.id));
  for (const hub of [uniqueProject, uniqueCompany]) {
    if (!hub || seen.has(hub.id)) continue;
    mentioned.push(hub);
    seen.add(hub.id);
  }
  return {
    mentioned,
    uniqueProject,
    uniqueCompany,
  };
}

function metadataString(value: unknown, key: string): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = (value as Record<string, unknown>)[key];
  if (typeof raw !== 'string' && typeof raw !== 'number') return null;
  const text = String(raw).trim();
  return text.length > 0 ? text : null;
}

function aliasesForRow(aliases: unknown): string[] {
  return Array.isArray(aliases)
    ? aliases.filter((alias): alias is string => typeof alias === 'string')
    : [];
}

export async function loadLinkedWorkspaceHubsForRawEvent(args: {
  db: Db;
  teamId: string;
  sourceMetadata: unknown;
}): Promise<WorkspaceHub[]> {
  const calendarIds = new Set<string>();
  const calendarEventId = metadataString(args.sourceMetadata, 'calendar_event_id');
  if (calendarEventId) calendarIds.add(calendarEventId);

  const meetingId = metadataString(args.sourceMetadata, 'meeting_id');
  if (meetingId) {
    const [meeting] = await args.db
      .select({
        linkedCalendarEventId: meetings.linkedCalendarEventId,
        savedMeetingId: meetings.savedMeetingId,
      })
      .from(meetings)
      .where(and(eq(meetings.id, meetingId), eq(meetings.teamId, args.teamId)))
      .limit(1);
    if (meeting?.linkedCalendarEventId) calendarIds.add(meeting.linkedCalendarEventId);
    if (meeting?.savedMeetingId) {
      const siblings = await args.db
        .select({ linkedCalendarEventId: meetings.linkedCalendarEventId })
        .from(meetings)
        .where(
          and(
            eq(meetings.teamId, args.teamId),
            eq(meetings.savedMeetingId, meeting.savedMeetingId),
          ),
        )
        .limit(20);
      for (const sibling of siblings) {
        if (sibling.linkedCalendarEventId) calendarIds.add(sibling.linkedCalendarEventId);
      }
    }
  }
  if (calendarIds.size === 0) return [];

  const links = await args.db
    .select({ entityId: calendarEventEntities.entityId })
    .from(calendarEventEntities)
    .where(
      and(
        eq(calendarEventEntities.teamId, args.teamId),
        inArray(calendarEventEntities.calendarEventId, [...calendarIds]),
      ),
    );
  const entityIds = [...new Set(links.map((link) => link.entityId))];
  if (entityIds.length === 0) return [];

  const rows = await args.db
    .select({
      id: entities.id,
      type: entities.type,
      name: entities.canonicalName,
      aliases: entities.aliases,
      status: entities.status,
    })
    .from(entities)
    .where(
      and(
        eq(entities.teamId, args.teamId),
        inArray(entities.id, entityIds),
        isNull(entities.archivedAt),
        isNull(entities.mergedIntoId),
      ),
    );
  return rows
    .filter((row) => (WORKSPACE_HUB_TYPES as readonly string[]).includes(row.type))
    .map((row) => ({
      id: row.id,
      type: row.type,
      name: row.name,
      aliases: aliasesForRow(row.aliases),
      status: row.status,
    }));
}
