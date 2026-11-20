import { randomUUID } from 'node:crypto';

import { Temporal } from '@js-temporal/polyfill';
import {
  calendarEvents,
  calendarReminderPreferences,
  googleCalendarImports,
  teamMembers,
  type Db,
} from '@timeline/db';
import { and, eq, inArray, isNull, lt, sql } from 'drizzle-orm';
import { z } from 'zod';

import type { CalendarScopeDeps } from '#src/calendar/scope.js';
import { decryptJson, encryptJson } from '#src/crypto/secrets.js';
import { getEnv } from '#src/env.js';
import { assertValidTimezone } from '#src/time/index.js';

export const GOOGLE_CALENDAR_SCOPES = [
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
  'https://www.googleapis.com/auth/calendar.events.readonly',
] as const;

const API = 'https://www.googleapis.com/calendar/v3';
const POLL_MS = 15 * 60_000;
const DAY_MS = 24 * 60 * 60_000;
const MAX_PAGES = 100;
const connectionToken = z.object({ refreshToken: z.string().min(1) });
const tokenResponse = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1).optional(),
  scope: z.string().optional(),
});

class GoogleCalendarError extends Error {
  readonly status: number;

  constructor(status: number) {
    super('Google Calendar request failed');
    this.status = status;
  }
}

function googleCredentials() {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } = getEnv();
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) throw new Error('Google Calendar is unavailable');
  return { client_id: GOOGLE_CLIENT_ID, client_secret: GOOGLE_CLIENT_SECRET };
}

export function googleCalendarAuthorizeUrl(redirectUri: string, state: string, challenge: string) {
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.search = new URLSearchParams({
    client_id: googleCredentials().client_id,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: GOOGLE_CALENDAR_SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  }).toString();
  return url;
}

async function fetchToken(params: Record<string, string>) {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    body: new URLSearchParams({ ...googleCredentials(), ...params }),
    signal: AbortSignal.timeout(15_000),
    cache: 'no-store',
  });
  if (!response.ok) throw new GoogleCalendarError(response.status);
  return tokenResponse.parse(await response.json());
}

export async function exchangeGoogleCalendarCode(
  code: string,
  redirectUri: string,
  verifier: string,
) {
  const token = await fetchToken({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    code_verifier: verifier,
  });
  const scopes = new Set(token.scope?.split(' '));
  if (!token.refresh_token || !GOOGLE_CALENDAR_SCOPES.every((scope) => scopes.has(scope))) {
    throw new Error('Google Calendar permission was not granted');
  }
  return token.refresh_token;
}

type Connection = typeof googleCalendarImports.$inferSelect;
type Transaction = Parameters<Parameters<Db['transaction']>[0]>[0];

async function readAccessToken(connection: Connection) {
  const { refreshToken } = connectionToken.parse(decryptJson(connection));
  const token = await fetchToken({ grant_type: 'refresh_token', refresh_token: refreshToken });
  return token.access_token;
}

async function fetchPage<T>(
  path: string,
  params: URLSearchParams,
  accessToken: string,
  schema: z.ZodType<T>,
) {
  const response = await fetch(`${API}/${path}?${params.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(15_000),
    cache: 'no-store',
  });
  if (!response.ok) throw new GoogleCalendarError(response.status);
  return schema.parse(await response.json());
}

const calendarPage = z.object({
  nextPageToken: z.string().optional(),
  items: z
    .array(
      z.object({
        id: z.string().min(1),
        summary: z.string().optional(),
        summaryOverride: z.string().optional(),
        timeZone: z.string().optional(),
        accessRole: z.string(),
      }),
    )
    .default([]),
});

const providerDate = z.object({
  date: z.iso.date().optional(),
  dateTime: z.iso.datetime({ offset: true, local: true }).optional(),
  timeZone: z.string().optional(),
});

const providerEvent = z.object({
  iCalUID: z.string().optional(),
  id: z.string().min(1),
  status: z.string().optional(),
  summary: z.string().optional(),
  description: z.string().optional(),
  location: z.string().optional(),
  transparency: z.string().optional(),
  start: providerDate.optional(),
  end: providerDate.optional(),
});

const eventPage = z.object({
  items: z.array(providerEvent).default([]),
  nextPageToken: z.string().optional(),
  nextSyncToken: z.string().optional(),
});

export function normalizeGoogleCalendarEvent(
  input: z.infer<typeof providerEvent>,
  fallbackTimezone: string,
) {
  if (input.status === 'cancelled') return { externalEventId: input.id, cancelled: true as const };
  const zone = assertValidTimezone(input.start?.timeZone ?? fallbackTimezone);
  const allDay = Boolean(input.start?.date);
  const boundary = (value: z.infer<typeof providerDate> | undefined) =>
    value?.date
      ? new Date(Temporal.PlainDate.from(value.date).toZonedDateTime(zone).epochMilliseconds)
      : value?.dateTime
        ? /Z$|[+-]\d{2}:\d{2}$/.test(value.dateTime)
          ? new Date(value.dateTime)
          : value.timeZone
            ? new Date(
                Temporal.PlainDateTime.from(value.dateTime).toZonedDateTime(
                  assertValidTimezone(value.timeZone),
                ).epochMilliseconds,
              )
            : null
        : null;
  const startAt = boundary(input.start);
  const endAt = boundary(input.end);
  if (!startAt || !endAt || !Number.isFinite(startAt.getTime()) || endAt <= startAt) {
    return { externalEventId: input.id, cancelled: true as const };
  }
  const summary = input.summary?.trim().slice(0, 500);
  return {
    externalEventId: input.id,
    cancelled: false as const,
    title: summary ? summary : 'Calendar event',
    description: input.description?.slice(0, 20_000) ?? null,
    location: input.location?.slice(0, 2000) ?? null,
    startAt,
    endAt,
    allDay,
    timezone: zone,
    showAs:
      input.transparency === 'transparent'
        ? 'free'
        : input.status === 'tentative'
          ? 'tentative'
          : 'busy',
  };
}

async function fetchEvents(
  connection: Connection,
  token: string,
  cursor: string | null,
  now: Date,
) {
  if (!connection.calendarId) throw new Error('No selected calendar');
  const params = new URLSearchParams({
    maxResults: '1000',
    singleEvents: 'true',
    showDeleted: 'true',
  });
  if (cursor) {
    params.set('syncToken', cursor);
  } else {
    params.set('timeMin', new Date(now.getTime() - 365 * DAY_MS).toISOString());
    params.set('timeMax', new Date(now.getTime() + 730 * DAY_MS).toISOString());
  }
  const events = new Map<
    string,
    ReturnType<typeof normalizeGoogleCalendarEvent> & { iCalUID?: string }
  >();
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const result = await fetchPage(
      `calendars/${encodeURIComponent(connection.calendarId)}/events`,
      params,
      token,
      eventPage,
    );
    for (const item of result.items) {
      events.set(item.id, {
        ...normalizeGoogleCalendarEvent(item, connection.timezone ?? 'UTC'),
        ...(item.iCalUID ? { iCalUID: item.iCalUID } : {}),
      });
    }
    if (result.nextPageToken) {
      params.set('pageToken', result.nextPageToken);
    } else if (result.nextSyncToken) {
      return { events: [...events.values()], nextSyncToken: result.nextSyncToken };
    } else {
      throw new Error('Google calendar sync cursor missing');
    }
  }
  throw new Error('Google calendar sync exceeded the page limit');
}

function mirrorScope(connection: Connection) {
  return and(
    eq(calendarEvents.teamId, connection.teamId),
    eq(calendarEvents.externalCalendarId, connection.id),
    eq(calendarEvents.source, 'google'),
    isNull(calendarEvents.deletedAt),
  );
}

async function removeReminderPreferences(tx: Transaction, teamId: string, eventIds: string[]) {
  if (eventIds.length === 0) return;
  await tx
    .delete(calendarReminderPreferences)
    .where(
      and(
        eq(calendarReminderPreferences.teamId, teamId),
        inArray(calendarReminderPreferences.eventId, eventIds),
      ),
    );
}

async function removeMirrors(tx: Transaction, connection: Connection, now: Date) {
  const rows = await tx
    .update(calendarEvents)
    .set({ deletedAt: now, updatedAt: now })
    .where(mirrorScope(connection))
    .returning({ id: calendarEvents.id });
  await removeReminderPreferences(
    tx,
    connection.teamId,
    rows.map((row) => row.id),
  );
}

export function createGoogleCalendarScope({ db, teamId, userId, ensureMember }: CalendarScopeDeps) {
  const ownsConnection = and(
    eq(googleCalendarImports.teamId, teamId),
    eq(googleCalendarImports.userId, userId),
  );
  const load = async (tx: Db | Transaction = db) => {
    const [row] = await tx.select().from(googleCalendarImports).where(ownsConnection);
    return row ?? null;
  };

  async function listChoices(connection: Connection) {
    const token = await readAccessToken(connection);
    const params = new URLSearchParams({ maxResults: '250', minAccessRole: 'reader' });
    const choices = [];
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const result = await fetchPage('users/me/calendarList', params, token, calendarPage);
      choices.push(
        ...result.items.map((item) => ({
          id: item.id,
          name:
            [item.summaryOverride, item.summary].find((label) => label?.trim()) ??
            'Google Calendar',
          timezone: assertValidTimezone(item.timeZone ?? 'UTC'),
        })),
      );
      if (!result.nextPageToken) return choices;
      params.set('pageToken', result.nextPageToken);
    }
    throw new Error('Google calendar list exceeded the page limit');
  }

  async function lockSelection(tx: Transaction) {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${`calendar-import:${teamId}:${userId}`}, 0))`,
    );
  }

  return {
    async getImport() {
      await ensureMember();
      const row = await load();
      return row
        ? {
            calendarId: row.calendarId,
            calendarName: row.calendarName,
            lastSyncAt: row.lastSyncAt,
            syncStatus: row.syncStatus,
          }
        : null;
    },
    async connect(refreshToken: string) {
      await ensureMember();
      const secret = encryptJson({ refreshToken });
      const prior = await load();
      const retainsSelection = prior?.calendarId
        ? (await listChoices({ ...prior, ...secret })).some(
            (choice) => choice.id === prior.calendarId,
          )
        : false;
      await db.transaction(async (tx) => {
        await lockSelection(tx);
        const [membership] = await tx
          .select({ userId: teamMembers.userId })
          .from(teamMembers)
          .where(
            and(
              eq(teamMembers.teamId, teamId),
              eq(teamMembers.userId, userId),
              isNull(teamMembers.removedAt),
            ),
          );
        if (!membership) throw new Error('Workspace membership is required');
        const previous = await load(tx);
        if (
          previous &&
          previous.id === prior?.id &&
          previous.calendarId === prior.calendarId &&
          retainsSelection
        ) {
          await tx
            .update(googleCalendarImports)
            .set({
              ...secret,
              syncToken: null,
              nextSyncAt: new Date(),
              syncStatus: null,
              revision: previous.revision + 1,
            })
            .where(ownsConnection);
          return;
        }
        if (previous) {
          await removeMirrors(tx, previous, new Date());
          await tx.delete(googleCalendarImports).where(ownsConnection);
        }
        await tx.insert(googleCalendarImports).values({ teamId, userId, ...secret });
      });
    },
    async listChoices() {
      await ensureMember();
      const connection = await load();
      return connection ? listChoices(connection) : [];
    },
    async selectCalendar(calendarId: string) {
      await ensureMember();
      const connection = await load();
      if (!connection) return false;
      const choice = (await listChoices(connection)).find((item) => item.id === calendarId);
      if (!choice) return false;
      return db.transaction(async (tx) => {
        await lockSelection(tx);
        const active = await load(tx);
        if (active?.id !== connection.id) return false;
        if (active.calendarId !== choice.id) await removeMirrors(tx, active, new Date());
        await tx
          .update(googleCalendarImports)
          .set({
            calendarId: choice.id,
            calendarName: choice.name,
            timezone: choice.timezone,
            nextSyncAt: new Date(),
            syncStatus: null,
            revision: active.revision + 1,
            ...(active.calendarId === choice.id
              ? {}
              : { id: randomUUID(), syncToken: null, lastSyncAt: null, lastFullSyncAt: null }),
          })
          .where(ownsConnection);
        return true;
      });
    },
    async disconnect() {
      await ensureMember();
      await db.transaction(async (tx) => {
        await lockSelection(tx);
        const active = await load(tx);
        if (!active) return;
        await removeMirrors(tx, active, new Date());
        await tx.delete(googleCalendarImports).where(ownsConnection);
      });
    },
    async sync(now = new Date()) {
      await ensureMember();
      const connection = await load();
      if (!connection?.calendarId || connection.nextSyncAt > now) return;
      let cursor =
        connection.lastFullSyncAt &&
        now.getTime() - connection.lastFullSyncAt.getTime() < 7 * DAY_MS
          ? connection.syncToken
          : null;
      try {
        const token = await readAccessToken(connection);
        const result = await fetchEvents(connection, token, cursor, now).catch((error: unknown) => {
          if (!(error instanceof GoogleCalendarError) || error.status !== 410 || !cursor)
            throw error;
          cursor = null;
          return fetchEvents(connection, token, null, now);
        });
        await ensureMember();
        await db.transaction(async (tx) => {
          await lockSelection(tx);
          const current = await load(tx);
          if (current?.id !== connection.id || current.revision !== connection.revision) return;
          const stamp = new Date(
            Math.max(Date.now(), now.getTime(), (current.lastSyncAt?.getTime() ?? 0) + 1),
          );
          // Google can subscribe to this workspace's outbound iCal feed.
          // A matching iCal UID is already represented on this calendar.
          const potentialEchoes = result.events.flatMap(({ iCalUID }) =>
            iCalUID && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(iCalUID)
              ? [iCalUID]
              : [],
          );
          const ownUids = new Set(
            potentialEchoes.length
              ? (
                  await tx
                    .select({ id: calendarEvents.id })
                    .from(calendarEvents)
                    .where(
                      and(
                        eq(calendarEvents.teamId, teamId),
                        sql`${calendarEvents.id} = ANY(${sql.param(potentialEchoes)}::uuid[])`,
                      ),
                    )
                ).map((row) => row.id)
              : [],
          );
          const isEcho = (uid: string | undefined) =>
            Boolean(uid && ownUids.has(uid.toLowerCase()));
          const cancelledIds = result.events
            .filter((event) => event.cancelled || isEcho(event.iCalUID))
            .map((event) => event.externalEventId);
          const currentEvents = result.events.filter(
            (event): event is typeof event & { cancelled: false } =>
              !event.cancelled && !isEcho(event.iCalUID),
          );
          for (let offset = 0; offset < currentEvents.length; offset += 250) {
            const chunk = currentEvents.slice(offset, offset + 250);
            await tx
              .insert(calendarEvents)
              .values(
                chunk.map(({ cancelled: _cancelled, iCalUID: _iCalUID, ...event }) => ({
                  ...event,
                  teamId,
                  createdByUserId: userId,
                  visibility: 'private' as const,
                  source: 'google' as const,
                  externalCalendarId: connection.id,
                  updatedAt: stamp,
                })),
              )
              .onConflictDoUpdate({
                target: [
                  calendarEvents.teamId,
                  calendarEvents.externalCalendarId,
                  calendarEvents.externalEventId,
                ],
                targetWhere: sql`${calendarEvents.externalEventId} IS NOT NULL`,
                set: {
                  title: sql`excluded.title`,
                  description: sql`excluded.description`,
                  location: sql`excluded.location`,
                  startAt: sql`excluded.start_at`,
                  endAt: sql`excluded.end_at`,
                  timezone: sql`excluded.timezone`,
                  allDay: sql`excluded.all_day`,
                  showAs: sql`excluded.show_as`,
                  updatedAt: stamp,
                  deletedAt: null,
                },
              });
          }
          if (!cursor || cancelledIds.length > 0) {
            const removal = cursor
              ? sql`${calendarEvents.externalEventId} = ANY(${sql.param(cancelledIds)}::text[])`
              : lt(calendarEvents.updatedAt, stamp);
            const removed = await tx
              .update(calendarEvents)
              .set({ deletedAt: stamp, updatedAt: stamp })
              .where(and(mirrorScope(connection), removal))
              .returning({ id: calendarEvents.id });
            await removeReminderPreferences(
              tx,
              teamId,
              removed.map((row) => row.id),
            );
          }
          await tx
            .update(googleCalendarImports)
            .set({
              lastSyncAt: stamp,
              syncToken: result.nextSyncToken,
              nextSyncAt: new Date(stamp.getTime() + POLL_MS),
              ...(cursor ? {} : { lastFullSyncAt: stamp }),
              syncStatus: null,
              revision: current.revision + 1,
            })
            .where(ownsConnection);
        });
      } catch (error) {
        const reconnect =
          error instanceof GoogleCalendarError && [400, 401, 403, 404].includes(error.status);
        await db
          .update(googleCalendarImports)
          .set({
            syncStatus: reconnect ? 'reconnect' : 'retrying',
            nextSyncAt: new Date(now.getTime() + (reconnect ? 24 * POLL_MS : POLL_MS)),
          })
          .where(
            and(
              ownsConnection,
              eq(googleCalendarImports.id, connection.id),
              eq(googleCalendarImports.revision, connection.revision),
            ),
          );
      }
    },
  };
}
