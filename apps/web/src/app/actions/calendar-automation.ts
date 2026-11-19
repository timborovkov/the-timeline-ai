'use server';

import { withTeam } from '@timeline/shared/team-scope';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';

async function calendarScope() {
  const session = await auth();
  if (!session?.user) return null;
  const { active } = await resolveActiveTeam(session.user.id);
  return active ? withTeam(db, active.teamId, session.user.id).calendar : null;
}

export async function listGoogleCalendarChoices() {
  try {
    const scope = await calendarScope();
    if (scope) return { ok: true, choices: await scope.google.listChoices() };
  } catch {
    return { ok: false, error: 'Couldn’t load your calendars. Try reconnecting Google Calendar.' };
  }
  return { ok: false, error: 'Choose a workspace and sign in again.' };
}

export async function selectGoogleCalendar(calendarId: string) {
  if (!z.string().min(1).max(2048).safeParse(calendarId).success) {
    return { ok: false, error: 'Select a calendar.' };
  }
  try {
    const scope = await calendarScope();
    if (scope && (await scope.google.selectCalendar(calendarId))) {
      revalidatePath('/app/calendar');
      return { ok: true };
    }
  } catch {
    return { ok: false, error: 'Couldn’t select this calendar. Try reconnecting Google Calendar.' };
  }
  return { ok: false, error: 'This calendar is no longer available.' };
}

export async function disconnectGoogleCalendar() {
  const scope = await calendarScope();
  if (!scope) return { ok: false, error: 'Choose a workspace and sign in again.' };
  await scope.google.disconnect();
  revalidatePath('/app/calendar');
  return { ok: true };
}

export async function getEventReminder(eventId: string) {
  if (!z.uuid().safeParse(eventId).success) return null;
  const scope = await calendarScope();
  return scope?.reminders.getPreference(eventId) ?? null;
}

export async function changeEventReminder(eventId: string, leadMinutes: number | null) {
  if (
    !z.uuid().safeParse(eventId).success ||
    !z.number().int().min(1).max(1440).nullable().safeParse(leadMinutes).success
  ) {
    return { ok: false, error: 'Choose a valid reminder time.' };
  }
  const scope = await calendarScope();
  return (await scope?.reminders.setPreference(eventId, leadMinutes))
    ? { ok: true }
    : { ok: false, error: 'Reminders are unavailable for this event.' };
}

export async function changeEventReminderBlock(eventId: string, blocked: boolean, series: boolean) {
  if (
    !z.uuid().safeParse(eventId).success ||
    typeof blocked !== 'boolean' ||
    typeof series !== 'boolean'
  ) {
    return { ok: false, error: 'Choose a valid reminder setting.' };
  }
  const scope = await calendarScope();
  return (await scope?.reminders.setBlock(eventId, blocked, series))
    ? { ok: true }
    : { ok: false, error: 'Only the event organizer can change this setting.' };
}
