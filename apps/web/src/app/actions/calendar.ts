'use server';
import { childLogger } from '@timeline/shared/logger';
import { withTeam } from '@timeline/shared/team-scope';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';

const log = childLogger('web:actions:calendar');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Result {
  ok: boolean;
  error?: string;
  id?: string;
}

async function withScopeOrError() {
  const session = await auth();
  if (!session?.user) return { error: 'Not signed in' as const };
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) return { error: 'No active team' as const };
  const scope = withTeam(db, active.teamId, session.user.id);
  return { scope, teamId: active.teamId, userId: session.user.id };
}

const createSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional(),
  startAt: z.iso.datetime(),
  endAt: z.iso.datetime(),
  timezone: z.string().max(100).default('UTC'),
  allDay: z.boolean().default(false),
  location: z.string().trim().max(500).optional(),
  visibility: z.enum(['team', 'private', 'specific_users']).default('team'),
  visibilityUserIds: z.array(z.string().regex(UUID_RE)).optional(),
  reminderMinutes: z.number().int().min(0).max(1440).optional(),
  linkedEntityIds: z.array(z.string().regex(UUID_RE)).max(20).optional(),
});

export async function createCalendarEventAction(
  input: z.input<typeof createSchema>,
): Promise<Result> {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message };

  const start = new Date(parsed.data.startAt);
  const end = new Date(parsed.data.endAt);
  if (end <= start) return { ok: false, error: 'End time must be after start time' };

  const got = await withScopeOrError();
  if ('error' in got) return { ok: false, error: got.error };

  try {
    const event = await got.scope.calendar.createCalendarEvent({
      title: parsed.data.title,
      description: parsed.data.description ?? null,
      startAt: start,
      endAt: end,
      timezone: parsed.data.timezone,
      allDay: parsed.data.allDay,
      location: parsed.data.location ?? null,
      visibility: parsed.data.visibility,
      visibilityUserIds: parsed.data.visibilityUserIds ?? null,
      reminderMinutes: parsed.data.reminderMinutes ?? null,
      linkedEntityIds: parsed.data.linkedEntityIds,
    });
    revalidatePath('/app/calendar');
    return { ok: true, id: event.id };
  } catch (err) {
    log.error({ err }, 'create_calendar_event_failed');
    return { ok: false, error: err instanceof Error ? err.message : 'Failed to create event' };
  }
}

const updateSchema = z.object({
  id: z.string().regex(UUID_RE),
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(2000).optional(),
  startAt: z.iso.datetime().optional(),
  endAt: z.iso.datetime().optional(),
  timezone: z.string().max(100).optional(),
  allDay: z.boolean().optional(),
  location: z.string().trim().max(500).optional(),
  visibility: z.enum(['team', 'private', 'specific_users']).optional(),
  visibilityUserIds: z.array(z.string().regex(UUID_RE)).optional(),
  reminderMinutes: z.number().int().min(0).max(1440).optional(),
});

export async function updateCalendarEventAction(
  input: z.input<typeof updateSchema>,
): Promise<Result> {
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message };

  const got = await withScopeOrError();
  if ('error' in got) return { ok: false, error: got.error };

  try {
    const patch: Record<string, unknown> = {};
    if (parsed.data.title !== undefined) patch.title = parsed.data.title;
    if (parsed.data.description !== undefined) patch.description = parsed.data.description;
    if (parsed.data.startAt !== undefined) patch.startAt = new Date(parsed.data.startAt);
    if (parsed.data.endAt !== undefined) patch.endAt = new Date(parsed.data.endAt);
    if (parsed.data.timezone !== undefined) patch.timezone = parsed.data.timezone;
    if (parsed.data.allDay !== undefined) patch.allDay = parsed.data.allDay;
    if (parsed.data.location !== undefined) patch.location = parsed.data.location;
    if (parsed.data.visibility !== undefined) patch.visibility = parsed.data.visibility;
    if (parsed.data.visibilityUserIds !== undefined)
      patch.visibilityUserIds = parsed.data.visibilityUserIds;
    if (parsed.data.reminderMinutes !== undefined)
      patch.reminderMinutes = parsed.data.reminderMinutes;

    const updated = await got.scope.calendar.updateCalendarEvent(parsed.data.id, patch);
    if (!updated) return { ok: false, error: 'Event not found' };
    revalidatePath('/app/calendar');
    revalidatePath(`/app/calendar/${parsed.data.id}`);
    return { ok: true, id: updated.id };
  } catch (err) {
    log.error({ err }, 'update_calendar_event_failed');
    return { ok: false, error: err instanceof Error ? err.message : 'Failed to update event' };
  }
}

export async function deleteCalendarEventAction(id: string): Promise<Result> {
  if (!UUID_RE.test(id)) return { ok: false, error: 'Invalid event id' };
  const got = await withScopeOrError();
  if ('error' in got) return { ok: false, error: got.error };

  try {
    const deleted = await got.scope.calendar.deleteCalendarEvent(id);
    if (!deleted) return { ok: false, error: 'Event not found' };
    revalidatePath('/app/calendar');
    return { ok: true, id };
  } catch (err) {
    log.error({ err }, 'delete_calendar_event_failed');
    return { ok: false, error: err instanceof Error ? err.message : 'Failed to delete event' };
  }
}
