import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import { type Db, ingestWebhookCredentials, ingestWebhooks } from '@timeline/db';
import { and, eq, isNull } from 'drizzle-orm';

import { isTimelineEventClass, type TimelineEventClass } from '#src/event-class.js';

const PREFIX = 'tli_';

export interface MintedIngestWebhookCredential {
  plaintext: string;
  prefix: string;
  hash: string;
}

export function mintCredential(): MintedIngestWebhookCredential {
  const secret = randomBytes(32).toString('base64url');
  const plaintext = `${PREFIX}${secret}`;
  return {
    plaintext,
    prefix: plaintext.slice(0, PREFIX.length + 8),
    hash: hashCredential(plaintext),
  };
}

export function hashCredential(plaintext: string): string {
  return createHash('sha256').update(plaintext).digest('hex');
}

export interface ResolvedIngestWebhookCredential {
  teamId: string;
  webhookId: string;
  credentialId: string;
  name: string;
  ownerUserId: string | null;
  visibilityDefault: 'private' | 'team' | 'specific_users';
  eventClass: TimelineEventClass;
  proposalGenerationEnabled: boolean;
}

export async function resolveCredential(
  db: Db,
  token: string,
): Promise<ResolvedIngestWebhookCredential | null> {
  if (!token.startsWith(PREFIX)) return null;
  const hash = hashCredential(token);
  const rows = await db
    .select({
      credentialId: ingestWebhookCredentials.id,
      teamId: ingestWebhookCredentials.teamId,
      keyHash: ingestWebhookCredentials.keyHash,
      webhookId: ingestWebhooks.id,
      name: ingestWebhooks.name,
      ownerUserId: ingestWebhooks.ownerUserId,
      visibilityDefault: ingestWebhooks.visibilityDefault,
      eventClass: ingestWebhooks.eventClass,
      proposalGenerationEnabled: ingestWebhooks.proposalGenerationEnabled,
    })
    .from(ingestWebhookCredentials)
    .innerJoin(ingestWebhooks, eq(ingestWebhooks.id, ingestWebhookCredentials.webhookId))
    .where(
      and(
        eq(ingestWebhookCredentials.keyHash, hash),
        isNull(ingestWebhookCredentials.revokedAt),
        isNull(ingestWebhooks.disabledAt),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  const a = Buffer.from(row.keyHash, 'hex');
  const b = Buffer.from(hash, 'hex');
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  void db
    .update(ingestWebhookCredentials)
    .set({ lastUsedAt: new Date(), updatedAt: new Date() })
    .where(eq(ingestWebhookCredentials.id, row.credentialId))
    .catch(() => undefined);
  return {
    teamId: row.teamId,
    webhookId: row.webhookId,
    credentialId: row.credentialId,
    name: row.name,
    ownerUserId: row.ownerUserId,
    visibilityDefault: row.visibilityDefault,
    eventClass: isTimelineEventClass(row.eventClass) ? row.eventClass : 'pulse',
    proposalGenerationEnabled: row.proposalGenerationEnabled,
  };
}

export function extractBearerToken(header: string | null): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1]?.trim() ?? null;
}
