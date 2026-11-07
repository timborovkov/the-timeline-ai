import { createHash, randomBytes } from 'node:crypto';

import {
  type Db,
  authContinuations,
  agentProvisioningGrants as grants,
  agentProvisioningReceipts as receipts,
  agentProvisioningAudit as audit,
  users,
  teamMembers,
  mcpOutboundKeys,
} from '@timeline/db';
import { and, desc, eq, gte, isNull, lt, sql } from 'drizzle-orm';
import { z } from 'zod';

import { createOwnedWorkspace } from '#src/agent-provisioning/workspace.js';
import { encryptJson, decryptJson } from '#src/crypto/secrets.js';
import { TERMS_VERSION, isCurrentPrivacyVersion } from '#src/legal-versions.js';
import { mintKey } from '#src/mcp-server/keys.js';
export {
  createOwnedWorkspace,
  initializeOwnedWorkspace,
} from '#src/agent-provisioning/workspace.js';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const day = 86400000;
export class ProvisioningError extends Error {
  constructor(
    public code: string,
    public status = 400,
  ) {
    super(code);
  }
}
export const provisioningGrantInput = z
  .object({
    name: z.string().trim().min(1).max(80),
    allowance: z.number().int().min(1).max(10).default(1),
    days: z.number().int().min(1).max(30).default(7),
    allowCapture: z.boolean().default(false),
  })
  .strict();
export const provisioningWorkspaceInput = z
  .object({
    name: z.string().trim().min(1).max(80),
    timezone: z
      .string()
      .max(100)
      .default('UTC')
      .refine((value) => {
        try {
          new Intl.DateTimeFormat('en', { timeZone: value });
          return true;
        } catch {
          return false;
        }
      }, 'Invalid timezone'),
    agentName: z.string().trim().min(1).max(80),
  })
  .strict();
type Store = Pick<Db, 'select' | 'insert' | 'update' | 'delete'>;

async function requireOwner(db: Store, ownerId: string) {
  const [owner] = await db.select().from(users).where(eq(users.id, ownerId)).limit(1);
  if (
    !owner ||
    owner.suspendedAt ||
    !owner.emailVerified ||
    owner.legalTermsVersion !== TERMS_VERSION ||
    !isCurrentPrivacyVersion(owner.legalPrivacyVersion) ||
    !owner.legalAcceptedAt
  )
    throw new ProvisioningError('verified_owner_required', 403);
  const [membership] = await db
    .select({ id: teamMembers.teamId })
    .from(teamMembers)
    .where(
      and(
        eq(teamMembers.userId, ownerId),
        eq(teamMembers.role, 'owner'),
        isNull(teamMembers.removedAt),
      ),
    )
    .limit(1);
  if (!membership) throw new ProvisioningError('owner_required', 403);
}
export async function createProvisioningGrant(db: Db, ownerId: string, raw: unknown) {
  const input = provisioningGrantInput.parse(raw);
  const token = `tlp_${randomBytes(32).toString('base64url')}`;
  return db.transaction(async (tx) => {
    await requireOwner(tx, ownerId);
    const [grant] = await tx
      .insert(grants)
      .values({
        ownerId,
        name: input.name,
        tokenHash: hash(token),
        prefix: token.slice(0, 12),
        allowance: input.allowance,
        allowCapture: input.allowCapture,
        expiresAt: new Date(Date.now() + input.days * day),
      })
      .returning({ id: grants.id });
    if (!grant) throw new Error('Grant creation failed');
    await tx.insert(audit).values({ ownerId, grantId: grant.id, action: 'grant.created' });
    return { id: grant.id, token };
  });
}
export async function listProvisioningGrants(db: Db, ownerId: string) {
  return db
    .select({
      id: grants.id,
      name: grants.name,
      prefix: grants.prefix,
      allowance: grants.allowance,
      used: grants.used,
      allowCapture: grants.allowCapture,
      expiresAt: grants.expiresAt,
      revokedAt: grants.revokedAt,
    })
    .from(grants)
    .where(eq(grants.ownerId, ownerId))
    .orderBy(desc(grants.createdAt));
}
export async function listProvisioningAudit(db: Db, ownerId: string) {
  return db
    .select({
      id: audit.id,
      action: audit.action,
      createdAt: audit.createdAt,
      grantId: audit.grantId,
    })
    .from(audit)
    .where(eq(audit.ownerId, ownerId))
    .orderBy(desc(audit.createdAt))
    .limit(100);
}
export async function revokeProvisioningGrant(db: Db, ownerId: string, id: string) {
  await db.transaction(async (tx) => {
    const [row] = await tx
      .update(grants)
      .set({ revokedAt: new Date() })
      .where(and(eq(grants.id, id), eq(grants.ownerId, ownerId)))
      .returning({ id: grants.id });
    if (row) await tx.insert(audit).values({ ownerId, grantId: id, action: 'grant.revoked' });
  });
}

export async function provisionWorkspace(
  db: Db,
  token: string,
  idempotencyKey: string,
  raw: unknown,
) {
  if (!/^tlp_[A-Za-z0-9_-]{43}$/.test(token))
    throw new ProvisioningError('invalid_credential', 401);
  const input = provisioningWorkspaceInput.parse(raw);
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(idempotencyKey))
    throw new ProvisioningError('invalid_idempotency_key');
  const [identity] = await db
    .select({
      id: grants.id,
      ownerId: grants.ownerId,
      revokedAt: grants.revokedAt,
      expiresAt: grants.expiresAt,
    })
    .from(grants)
    .where(eq(grants.tokenHash, hash(token)))
    .limit(1);
  if (!identity) throw new ProvisioningError('invalid_credential', 401);
  // Revoked credentials must not consume the owner's quota. Recheck under lock below.
  if (identity.revokedAt || identity.expiresAt.getTime() <= Date.now())
    throw new ProvisioningError('grant_unavailable', 401);
  // Commit the owner-wide rate counter independently so failed attempts count too.
  // Non-key locks serialize counters while allowing FK key-share checks in the
  // creation transaction; FOR UPDATE here would deadlock with the grant audit FK.
  await db.transaction(async (tx) => {
    await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, identity.ownerId))
      .for('no key update');
    const [{ count } = { count: 0 }] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(audit)
      .where(
        and(
          eq(audit.ownerId, identity.ownerId),
          eq(audit.action, 'provision.attempt'),
          gte(audit.createdAt, new Date(Date.now() - 3600000)),
        ),
      );
    if (count >= 5) throw new ProvisioningError('rate_limited', 429);
    await tx
      .insert(audit)
      .values({ ownerId: identity.ownerId, grantId: identity.id, action: 'provision.attempt' });
  });
  return db.transaction(async (tx) => {
    const [grant] = await tx
      .select()
      .from(grants)
      .where(eq(grants.id, identity.id))
      .for('no key update');
    if (!grant || grant.revokedAt || grant.expiresAt.getTime() <= Date.now())
      throw new ProvisioningError('grant_unavailable', 401);
    await requireOwner(tx, grant.ownerId);
    await tx
      .update(receipts)
      .set({ responseCiphertext: null, responseIv: null, responseTag: null })
      .where(and(eq(receipts.grantId, grant.id), lt(receipts.expiresAt, new Date())));
    const payloadHash = hash(JSON.stringify(input));
    const [receipt] = await tx
      .select()
      .from(receipts)
      .where(and(eq(receipts.grantId, grant.id), eq(receipts.idempotencyKey, idempotencyKey)));
    if (receipt) {
      if (receipt.payloadHash !== payloadHash)
        throw new ProvisioningError('idempotency_conflict', 409);
      if (
        !receipt.responseCiphertext ||
        !receipt.responseIv ||
        !receipt.responseTag ||
        receipt.expiresAt.getTime() <= Date.now()
      )
        throw new ProvisioningError('receipt_expired_reconnect_in_timeline', 409);
      return decryptJson({
        ciphertext: Buffer.from(receipt.responseCiphertext, 'base64'),
        iv: Buffer.from(receipt.responseIv, 'base64'),
        tag: Buffer.from(receipt.responseTag, 'base64'),
      });
    }
    if (grant.used >= grant.allowance)
      throw new ProvisioningError('workspace_allowance_reached', 403);
    const { team, billing } = await createOwnedWorkspace(tx, {
      ownerId: grant.ownerId,
      name: input.name,
      timezone: input.timezone,
    });
    const minted = mintKey();
    const scopes = grant.allowCapture ? ['read', 'capture'] : ['read'];
    const [connection] = await tx
      .insert(mcpOutboundKeys)
      .values({
        teamId: team.id,
        createdByUserId: grant.ownerId,
        name: input.agentName,
        keyHash: minted.hash,
        keyPrefix: minted.prefix,
        scopes,
      })
      .returning({ id: mcpOutboundKeys.id });
    if (!connection) throw new Error('Connection creation failed');
    const response = {
      workspace: team,
      connection: { id: connection.id, scopes },
      credential: minted.plaintext,
      billing,
    };
    const encrypted = encryptJson(response);
    await tx.insert(receipts).values({
      grantId: grant.id,
      idempotencyKey,
      payloadHash,
      responseCiphertext: encrypted.ciphertext.toString('base64'),
      responseIv: encrypted.iv.toString('base64'),
      responseTag: encrypted.tag.toString('base64'),
      expiresAt: new Date(Date.now() + 900000),
    });
    await tx
      .update(grants)
      .set({ used: grant.used + 1 })
      .where(eq(grants.id, grant.id));
    await tx.insert(audit).values({
      ownerId: grant.ownerId,
      grantId: grant.id,
      action: 'workspace.created',
      metadata: { teamId: team.id, connectionId: connection.id },
    });
    return response;
  });
}

/** Global credential retention: contains no workspace evidence. */
export async function pruneAgentCredentials(db: Db) {
  await db.delete(authContinuations).where(lt(authContinuations.expiresAt, new Date()));
  await db
    .update(receipts)
    .set({ responseCiphertext: null, responseIv: null, responseTag: null })
    .where(lt(receipts.expiresAt, new Date()));
}
