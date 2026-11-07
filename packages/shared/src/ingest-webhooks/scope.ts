import { auditLog, type Db, ingestWebhookCredentials, ingestWebhooks } from '@timeline/db';
import { and, desc, eq, isNull } from 'drizzle-orm';

import { isTimelineEventClass, type TimelineEventClass } from '#src/event-class.js';
import { mintCredential } from '#src/ingest-webhooks/keys.js';

export const AGENT_MEMORY_WEBHOOK_NAME = 'Agent memory';

export interface IngestWebhookCredentialView {
  id: string;
  prefix: string;
  lastUsedAt: Date | null;
  createdAt: Date;
}

export interface IngestWebhookView {
  id: string;
  name: string;
  visibilityDefault: string;
  eventClass: TimelineEventClass;
  proposalGenerationEnabled: boolean;
  disabledAt: Date | null;
  createdAt: Date;
  credentials: IngestWebhookCredentialView[];
}

export interface CreatedIngestWebhook {
  webhook: IngestWebhookView;
  plaintext: string;
}

interface IngestWebhookScopeDeps {
  db: Db;
  teamId: string;
  userId: string;
  ensureMember: (minRole?: 'member' | 'admin' | 'owner') => Promise<unknown>;
}

function eventClassOf(value: string): TimelineEventClass {
  return isTimelineEventClass(value) ? value : 'pulse';
}

function toWebhookView(
  webhook: typeof ingestWebhooks.$inferSelect,
  credentials: IngestWebhookCredentialView[] = [],
): IngestWebhookView {
  return {
    id: webhook.id,
    name: webhook.name,
    visibilityDefault: webhook.visibilityDefault,
    eventClass: eventClassOf(webhook.eventClass),
    proposalGenerationEnabled: webhook.proposalGenerationEnabled,
    disabledAt: webhook.disabledAt,
    createdAt: webhook.createdAt,
    credentials,
  };
}

export function createIngestWebhookScope({
  db,
  teamId,
  userId,
  ensureMember,
}: IngestWebhookScopeDeps) {
  async function listWebhooks(): Promise<IngestWebhookView[]> {
    await ensureMember('admin');
    const rows = await db
      .select({
        webhook: ingestWebhooks,
        credential: ingestWebhookCredentials,
      })
      .from(ingestWebhooks)
      .leftJoin(
        ingestWebhookCredentials,
        and(
          eq(ingestWebhookCredentials.webhookId, ingestWebhooks.id),
          isNull(ingestWebhookCredentials.revokedAt),
        ),
      )
      .where(eq(ingestWebhooks.teamId, teamId))
      .orderBy(desc(ingestWebhooks.createdAt), desc(ingestWebhookCredentials.createdAt));

    const byId = new Map<string, IngestWebhookView>();
    for (const row of rows) {
      const existing = byId.get(row.webhook.id) ?? toWebhookView(row.webhook);
      if (row.credential) {
        existing.credentials.push({
          id: row.credential.id,
          prefix: row.credential.keyPrefix,
          lastUsedAt: row.credential.lastUsedAt,
          createdAt: row.credential.createdAt,
        });
      }
      byId.set(row.webhook.id, existing);
    }
    return Array.from(byId.values());
  }

  async function createWebhook(input: {
    name: string;
    visibilityDefault?: 'team' | 'private';
    eventClass?: TimelineEventClass;
    proposalGenerationEnabled?: boolean;
  }): Promise<CreatedIngestWebhook> {
    await ensureMember('admin');
    const minted = mintCredential();
    const created = await db.transaction(async (tx) => {
      const webhookRows = await tx
        .insert(ingestWebhooks)
        .values({
          teamId,
          ownerUserId: userId,
          name: input.name,
          visibilityDefault: input.visibilityDefault ?? 'team',
          eventClass: input.eventClass ?? 'pulse',
          proposalGenerationEnabled: input.proposalGenerationEnabled ?? true,
        })
        .returning();
      const webhook = webhookRows[0];
      if (!webhook) throw new Error('create_failed');
      const credentialRows = await tx
        .insert(ingestWebhookCredentials)
        .values({
          teamId,
          webhookId: webhook.id,
          createdByUserId: userId,
          keyHash: minted.hash,
          keyPrefix: minted.prefix,
        })
        .returning();
      const credential = credentialRows[0];
      if (!credential) throw new Error('credential_create_failed');
      await tx.insert(auditLog).values({
        teamId,
        actorUserId: userId,
        action: 'ingest_webhook.create',
        targetType: 'ingest_webhook',
        targetId: webhook.id,
        targetVisibility: webhook.visibilityDefault,
        targetOwnerUserId: webhook.ownerUserId,
        metadata: { credential_id: credential.id },
      });
      return { webhook, credential };
    });
    return {
      webhook: toWebhookView(created.webhook, [
        {
          id: created.credential.id,
          prefix: created.credential.keyPrefix,
          lastUsedAt: created.credential.lastUsedAt,
          createdAt: created.credential.createdAt,
        },
      ]),
      plaintext: minted.plaintext,
    };
  }

  async function createAgentMemoryWebhook(): Promise<
    | { created: true; webhook: IngestWebhookView; plaintext: string }
    | { created: false; webhook: IngestWebhookView }
  > {
    await ensureMember('admin');
    const existing = (await listWebhooks()).find(
      (webhook) => webhook.name === AGENT_MEMORY_WEBHOOK_NAME && !webhook.disabledAt,
    );
    if (existing) return { created: false, webhook: existing };
    const created = await createWebhook({
      name: AGENT_MEMORY_WEBHOOK_NAME,
      visibilityDefault: 'team',
      eventClass: 'communication',
      proposalGenerationEnabled: true,
    });
    return { created: true, webhook: created.webhook, plaintext: created.plaintext };
  }

  return { listWebhooks, createWebhook, createAgentMemoryWebhook };
}
