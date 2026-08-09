import { rawEvents } from '@timeline/db';
import { and, eq, or, sql } from 'drizzle-orm';

type VisibilityValue = 'private' | 'team' | 'specific_users';

export interface VisibilityAudienceEnvelope {
  visibility: VisibilityValue;
  visibilityOwnerUserId?: string | null;
  visibilityUserIds?: string[] | null;
}

export function intersectVisibilityEnvelopes(
  envelopes: readonly VisibilityAudienceEnvelope[],
  messages: { missingPrivateOwner?: string; emptyAudience?: string } = {},
): Required<VisibilityAudienceEnvelope> {
  let allowedUserIds: string[] | null = null;
  let includesPrivateEnvelope = false;
  for (const envelope of envelopes) {
    if (envelope.visibility === 'team') continue;
    let envelopeUserIds: string[];
    if (envelope.visibility === 'private') {
      includesPrivateEnvelope = true;
      if (!envelope.visibilityOwnerUserId) {
        throw new Error(messages.missingPrivateOwner ?? 'Private evidence has no visible owner');
      }
      envelopeUserIds = [envelope.visibilityOwnerUserId];
    } else {
      envelopeUserIds = [...new Set(envelope.visibilityUserIds ?? [])].sort();
    }
    allowedUserIds =
      allowedUserIds === null
        ? envelopeUserIds
        : allowedUserIds.filter((id) => envelopeUserIds.includes(id));
  }
  if (allowedUserIds === null) {
    return { visibility: 'team', visibilityOwnerUserId: null, visibilityUserIds: null };
  }
  if (allowedUserIds.length === 0) {
    throw new Error(messages.emptyAudience ?? 'Evidence has no common visible audience');
  }
  if (includesPrivateEnvelope && allowedUserIds.length === 1) {
    return {
      visibility: 'private',
      visibilityOwnerUserId: allowedUserIds[0] ?? null,
      visibilityUserIds: null,
    };
  }
  return {
    visibility: 'specific_users',
    visibilityOwnerUserId: null,
    visibilityUserIds: allowedUserIds,
  };
}

export function normalizeVisibilityUserIds(
  visibility: VisibilityValue,
  ids: string[] | null | undefined,
): string[] | null {
  if (visibility !== 'specific_users') return null;
  const clean = [...new Set(ids ?? [])];
  if (clean.length === 0) throw new Error('specific_users visibility requires at least one user');
  return clean;
}

export async function validateVisibilityUserIds(
  visibility: VisibilityValue,
  ids: string[] | null | undefined,
  requireTeamMember?: (userId: string) => Promise<void>,
): Promise<string[] | null> {
  const clean = normalizeVisibilityUserIds(visibility, ids);
  if (clean && requireTeamMember) {
    for (const uid of clean) await requireTeamMember(uid);
  }
  return clean;
}

export function rawEventVisibleToUser(userId: string) {
  return or(
    eq(rawEvents.visibility, 'team'),
    and(
      eq(rawEvents.visibility, 'private'),
      or(eq(rawEvents.authorUserId, userId), eq(rawEvents.visibilityOwnerUserId, userId)),
    ),
    and(
      eq(rawEvents.visibility, 'specific_users'),
      sql`COALESCE(${userId}::uuid = ANY(${rawEvents.visibilityUserIds}), false)`,
    ),
  );
}

export function rawEventIsActive() {
  return sql`COALESCE(${rawEvents.sourceMetadata} ->> 'deleted', 'false') <> 'true'`;
}

export function rawEventHiddenFromUser(userId: string) {
  return or(
    and(
      eq(rawEvents.visibility, 'private'),
      sql`${rawEvents.authorUserId} IS DISTINCT FROM ${userId}::uuid`,
      sql`${rawEvents.visibilityOwnerUserId} IS DISTINCT FROM ${userId}::uuid`,
    ),
    and(
      eq(rawEvents.visibility, 'specific_users'),
      sql`NOT COALESCE(${userId}::uuid = ANY(${rawEvents.visibilityUserIds}), false)`,
    ),
  );
}
